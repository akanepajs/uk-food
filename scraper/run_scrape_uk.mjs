// Daily UK plant-vs-meat price scrape, RETAILER-DIRECT (since 2026-07-22).
// Sources: Sainsbury's own product API (rows where the register side carries
// 'sains_api') and Morrisons product pages ('morr': price read from the page's
// schema.org JSON-LD). The aggregator trolley.co.uk was dropped on 2026-07-22
// after a terms review; its rows up to that date remain in the history as a
// frozen series and are never fetched again. Pairs flagged 'retired' in the
// register are skipped (no compliant direct route for their chain).
//
// per-100 basis: always the register's hand-verified pack amount
// (price / amount * 100). The retailer's own displayed unit price is used only
// as a cross-check (warn > 2% mismatch), mirroring the wholesale scraper's
// discipline: the register amount, not the retailer's derived figure, is the
// source of truth.
//
// Fail-loud policy (unchanged): a bot-block signal (403/429/challenge) aborts
// without writing; 3+ product failures abort without writing, so a transient
// outage never lands in the history as a fake price gap.
//
// Usage: node run_scrape_uk.mjs [run-date YYYY-MM-DD]

import { mkdir, readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const runDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const register = JSON.parse(await readFile(new URL("./pairs.json", import.meta.url), "utf8"));

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

let blocked = null;
const failures = [];
const warnings = [];
const rows = [];

// Cross-check a computed per-100 figure against a retailer-displayed unit price.
function xcheck(tag, per100, retailerPer100) {
  if (per100 == null || retailerPer100 == null) return;
  const rel = Math.abs(per100 - retailerPer100) / retailerPer100;
  if (rel > 0.02) warnings.push(`${tag}: register-based ${per100} vs retailer unit price ${retailerPer100} (${(rel * 100).toFixed(1)}% apart); register basis kept`);
}

// Parse a Morrisons JSON-LD size string ("750ml", "775g", "3 x 90ml", "3x100ml")
// to a total amount in the register's unit (g or ml). Returns null if unparseable.
function parseSize(text) {
  const s = String(text || "").toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(?:(\d+(?:\.\d+)?)x)?(\d+(?:\.\d+)?)(g|kg|ml|l|ltr)$/);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  let v = Number(m[2]) * count;
  if (m[3] === "kg" || m[3] === "l" || m[3] === "ltr") v *= 1000;
  return v;
}

async function fetchSains(pair, side) {
  const prod = pair[side];
  const cfg = prod.sains_api;
  if (!cfg) return;
  const amount = cfg.amount ?? prod.amount;
  const unit = cfg.unit ?? prod.unit;
  const u = "https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter[keyword]="
    + encodeURIComponent(cfg.query);
  const r = await fetch(u, { headers: { ...H, "Accept": "application/json" } });
  if (r.status === 403 || r.status === 429) { blocked = `Sainsbury's HTTP ${r.status} on ${pair.pair_id}/${side}`; return; }
  if (!r.ok) { failures.push(`${pair.pair_id}/${side} (Sainsbury's): HTTP ${r.status}`); return; }
  const j = await r.json();
  const want = norm(cfg.name);
  let cands = (j.products || []).filter(p => norm(p.name).includes(want));
  // Disambiguate identically named listings (the API can carry two products with
  // the same display name at different prices) by URL slug when the register
  // provides one.
  if (cfg.url_hint) {
    const u = cands.filter(p => String(p.full_url || "").includes(cfg.url_hint));
    if (u.length) cands = u;
    else { failures.push(`${pair.pair_id}/${side} (Sainsbury's): no candidate URL contains "${cfg.url_hint}"`); return; }
  }
  const hit = cands[0];
  if (!hit || !hit.retail_price) { failures.push(`${pair.pair_id}/${side} (Sainsbury's): no product matching "${cfg.name}"`); return; }
  if (!amount) { failures.push(`${pair.pair_id}/${side} (Sainsbury's): no register amount`); return; }
  const per100 = Number((hit.retail_price.price / amount * 100).toFixed(4));
  const up = hit.unit_price;
  if (up && up.price != null) {
    if (/^(kg|ltr|l)$/i.test(up.measure)) xcheck(`${pair.pair_id}/${side} S`, per100, Number((up.price / 10).toFixed(4)));
    else if (/^100\s?(g|ml)$/i.test(up.measure)) xcheck(`${pair.pair_id}/${side} S`, per100, Number(up.price.toFixed(4)));
  }
  rows.push({
    date: runDate, pair_id: pair.pair_id, category: pair.category, chain: pair.chain,
    side, store: "Sainsbury's", label: hit.name, price_gbp: hit.retail_price.price, per100,
    unit, offer: null, source: "sainsburys_api", amount, amount_basis: "register", api_name: hit.name,
  });
}

async function fetchMorrisons(pair, side) {
  const prod = pair[side];
  const cfg = prod.morr;
  if (!cfg) return;
  const url = "https://groceries.morrisons.com" + cfg.path;
  const r = await fetch(url, { headers: H });
  if (r.status === 403 || r.status === 429) { blocked = `Morrisons HTTP ${r.status} on ${pair.pair_id}/${side}`; return; }
  if (!r.ok) { failures.push(`${pair.pair_id}/${side} (Morrisons): HTTP ${r.status}`); return; }
  const html = await r.text();
  if (/just a moment|challenge-platform|Attention Required!/i.test(html.slice(0, 3000))) {
    blocked = `Morrisons challenge page on ${pair.pair_id}/${side}`; return;
  }
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { failures.push(`${pair.pair_id}/${side} (Morrisons): no JSON-LD on page`); return; }
  let p;
  try {
    const j = JSON.parse(m[1]);
    p = Array.isArray(j) ? j.find(x => x["@type"] === "Product") : j;
  } catch (e) { failures.push(`${pair.pair_id}/${side} (Morrisons): JSON-LD parse: ${e.message}`); return; }
  const price = p && p.offers ? Number(p.offers.price) : null;
  if (!p || !price) { failures.push(`${pair.pair_id}/${side} (Morrisons): no price in JSON-LD`); return; }
  // Guard against a silent relist/pack change: the page's own size string must
  // match the register amount when it parses.
  const ldAmount = parseSize(p.size);
  if (ldAmount != null && Math.abs(ldAmount - cfg.amount) > 0.5) {
    failures.push(`${pair.pair_id}/${side} (Morrisons): page size ${p.size} (=${ldAmount}${cfg.unit}) != register ${cfg.amount}${cfg.unit}`);
    return;
  }
  const per100 = Number((price / cfg.amount * 100).toFixed(4));
  rows.push({
    date: runDate, pair_id: pair.pair_id, category: pair.category, chain: pair.chain,
    side, store: "Morrisons", label: p.name || cfg.name, price_gbp: price, per100,
    unit: cfg.unit, offer: null, source: "morrisons_page", amount: cfg.amount, amount_basis: "register", api_name: p.name,
  });
}

for (const pair of register.pairs) {
  if (pair.retired) continue;
  for (const side of ["plant", "meat"]) {
    if (blocked) break;
    await fetchSains(pair, side);
    await sleep(500);
    if (blocked) break;
    await fetchMorrisons(pair, side);
    await sleep(700);
  }
  if (blocked) break;
}

if (blocked) {
  console.error(`FATAL: a retailer appears to be blocking this client (${blocked}). Writing nothing.`);
  process.exit(2);
}
if (failures.length >= 3) {
  console.error(`FATAL: ${failures.length} product failures. Writing nothing.\n` + failures.join("\n"));
  process.exit(1);
}
if (failures.length) console.error("WARN (continuing):\n" + failures.join("\n"));
if (warnings.length) console.error("XCHECK warnings:\n" + warnings.join("\n"));

await mkdir(new URL("./data/raw/", import.meta.url), { recursive: true });
await mkdir(new URL("./data/history/", import.meta.url), { recursive: true });
await writeFile(new URL(`./data/raw/${runDate}_products.json`, import.meta.url), JSON.stringify(rows, null, 2));

// History: flat rows, upsert per date. Refuse to overwrite a corrupt file.
const histPath = new URL("./data/history/history.json", import.meta.url);
let hist = [];
try {
  hist = JSON.parse(await readFile(histPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw new Error(`history.json unreadable; refusing to overwrite: ${e.message}`);
}
// Upsert only this run's retailer-direct rows; frozen trolley-era rows for the
// same date (2026-07-22 overlap day) are preserved.
hist = hist.filter(r => !(r.date === runDate && (r.source === "sainsburys_api" || r.source === "morrisons_page")));
hist.push(...rows);
hist.sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1)
  : a.pair_id !== b.pair_id ? a.pair_id.localeCompare(b.pair_id)
  : a.side !== b.side ? a.side.localeCompare(b.side) : a.store.localeCompare(b.store));
await writeFile(histPath, JSON.stringify(hist, null, 1));

// CSV mirror for download.
const cols = ["date", "pair_id", "category", "chain", "side", "store", "label", "price_gbp", "per100", "unit", "offer", "source", "amount", "amount_basis"];
const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
await writeFile(new URL("./data/history/history.csv", import.meta.url),
  cols.join(",") + "\n" + hist.map(r => cols.map(c => esc(r[c])).join(",")).join("\n") + "\n");

const dates = new Set(hist.map(r => r.date));
console.log(`OK: ${rows.length} product-store rows on ${runDate} (${failures.length} product failures); history now ${hist.length} rows across ${dates.size} date(s).`);
console.log(`Sainsbury's API rows: ${rows.filter(r => r.source === "sainsburys_api").length}; Morrisons rows: ${rows.filter(r => r.source === "morrisons_page").length}`);
