// Daily UK wholesale (foodservice) plant-vs-meat price scrape. Walks the curated
// register in pairs_wholesale.json across two distributors whose product pages
// are publicly fetchable (probed 2026-07-07):
//
// - JJ Foodservice: /product/england/<SKU> pages server-render a schema.org
//   Product/Offer JSON-LD block with per-branch Collection/Delivery prices in
//   GBP. Canonical price = Collection at the register's jj_branch (Enfield
//   EN-MW); min/max across branches recorded alongside. Prices are ex-VAT
//   sitewide (T&Cs 5.4). robots.txt allows /product/ pages.
// - Brakes: product pages server-render an ng-state JSON blob with an
//   anonymous indicative price ("average customer discount", nettPrices=false),
//   pack size and the retailer's own per-kg unit price. robots.txt sets
//   Crawl-delay 10 and Visit-time 0400-0845 UTC: requests are paced 11s apart
//   and the cron must run inside that window.
//
// Wholesale rows go to their own history (data/history/history_wholesale.json
// + CSV mirror), never into the retail history. per-100 figures come from the
// register's hand-verified pack amounts; where the distributor publishes its
// own per-kg unit price (Brakes), the scraper cross-checks and fails the row
// on a >1% disagreement rather than writing a wrong number.
//
// Fail-loud policy (mirrors run_scrape_uk.mjs): a bot-block signal (403/429/
// challenge) or 3+ product failures aborts without writing, so a transient
// outage never lands in the history as a fake price gap.
//
// Usage: node run_scrape_wholesale.mjs [run-date YYYY-MM-DD]

import { mkdir, readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const runDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const register = JSON.parse(await readFile(new URL("./pairs_wholesale.json", import.meta.url), "utf8"));
const JJ_BRANCH = register.jj_branch;

let blocked = null;
const failures = [];
const rows = [];

function per100(price, amount) {
  return Number((price / amount * 100).toFixed(4));
}

// ---- JJ Foodservice: JSON-LD offers per branch ----
function jjParseProduct(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1]);
      if (j["@type"] === "Product") return j;
    } catch { /* other JSON-LD blocks (WebSite) or malformed: skip */ }
  }
  return null;
}

async function fetchJJ(pair, side) {
  const prod = pair[side];
  const url = `https://www.jjfoodservice.com/product/england/${prod.sku}`;
  const r = await fetch(url, { headers: H });
  if (r.status === 403 || r.status === 429) { blocked = `JJ HTTP ${r.status} on ${prod.sku}`; return; }
  if (!r.ok) { failures.push(`${pair.pair_id}/${side}: JJ HTTP ${r.status}`); return; }
  const html = await r.text();
  if (/cf-challenge|Attention Required!|just a moment/i.test(html.slice(0, 3000))) {
    blocked = `JJ challenge page on ${prod.sku}`; return;
  }
  const p = jjParseProduct(html);
  if (!p) { failures.push(`${pair.pair_id}/${side}: no Product JSON-LD (delisted?) ${prod.sku}`); return; }
  const offers = (Array.isArray(p.offers) ? p.offers : [p.offers]).filter(Boolean);
  const branchOffers = offers
    .map(o => ({
      seller: o.seller?.name || "",
      branch: o.availableAtOrFrom?.branchCode || null,
      price: Number(o.price),
      inStock: /InStock/i.test(o.availability || ""),
    }))
    .filter(o => o.branch && Number.isFinite(o.price));
  const coll = branchOffers.filter(o => /collection/i.test(o.seller));
  if (!coll.length) { failures.push(`${pair.pair_id}/${side}: no branch Collection offers ${prod.sku}`); return; }
  const canonical = coll.find(o => o.branch === JJ_BRANCH) || null;
  const prices = coll.map(o => o.price);
  const price = canonical ? canonical.price : Math.min(...prices);
  rows.push({
    date: runDate, pair_id: pair.pair_id, category: pair.category,
    distributor: pair.distributor, side, label: prod.label,
    price_gbp: price, per100: per100(price, prod.amount), unit: prod.unit,
    amount: prod.amount, pack_size: p.size || null,
    price_basis: canonical ? `collection ${JJ_BRANCH}` : "collection min (branch fallback)",
    branch_min: Math.min(...prices), branch_max: Math.max(...prices),
    in_stock: canonical ? canonical.inStock : null,
    was_price: null, vat: "ex-VAT", source: "jj_jsonld", ref: prod.sku,
  });
}

// ---- Brakes: ng-state entity ----
function brakesParseDetails(html, code) {
  const m = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let state;
  try { state = JSON.parse(m[1]); } catch { return null; }
  const cx = state["cx-state"] || state;
  const ent = cx.product?.details?.entities?.[code];
  return ent?.default?.value || ent?.variants?.value || ent?.value?.details?.value || null;
}

async function fetchBrakes(pair, side, attempt = 1) {
  const prod = pair[side];
  const url = "https://www.brake.co.uk" + prod.path;
  const r = await fetch(url, { headers: H });
  if (r.status === 403 || r.status === 429) { blocked = `Brakes HTTP ${r.status} on ${prod.code}`; return; }
  if (!r.ok) { failures.push(`${pair.pair_id}/${side}: Brakes HTTP ${r.status}`); return; }
  const html = await r.text();
  if (/cf-challenge|Attention Required!|just a moment/i.test(html.slice(0, 3000))) {
    blocked = `Brakes challenge page on ${prod.code}`; return;
  }
  const d = brakesParseDetails(html, prod.code);
  if (!d) {
    // Bare SPA shell: Brakes' SSR is stochastic per request (a page that renders
    // fine one minute can return the shell the next, seen from GitHub runners on
    // 2026-07-07), so retry up to 3 attempts before treating as delisted/failed.
    if (attempt < 3) { await sleep(11000); return fetchBrakes(pair, side, attempt + 1); }
    failures.push(`${pair.pair_id}/${side}: no ng-state after ${attempt} attempts (delisted?) ${prod.code}`);
    return;
  }
  const price = d.price?.value;
  if (!Number.isFinite(price)) { failures.push(`${pair.pair_id}/${side}: no price in ng-state ${prod.code}`); return; }
  const p100 = per100(price, prod.amount);
  // Cross-check our per-100 against the retailer's own per-kg/ltr unit price.
  const um = String(d.unitPriceStr || "").match(/£\s?(\d+(?:\.\d+)?)\s*\/\s*(kg|ltr|l)\b/i);
  if (um) {
    const theirsPer100 = Number(um[1]) / 10;
    if (Math.abs(theirsPer100 - p100) / theirsPer100 > 0.01) {
      failures.push(`${pair.pair_id}/${side}: per-100 mismatch ours ${p100} vs theirs ${theirsPer100} (${d.unitPriceStr}) ${prod.code}`);
      return;
    }
  }
  rows.push({
    date: runDate, pair_id: pair.pair_id, category: pair.category,
    distributor: pair.distributor, side, label: prod.label,
    price_gbp: price, per100: p100, unit: prod.unit,
    amount: prod.amount, pack_size: d.packSize || null,
    price_basis: "anonymous indicative (nettPrices=" + String(d.nettPrices) + ")",
    branch_min: null, branch_max: null,
    in_stock: d.stock?.stockLevelStatus ? d.stock.stockLevelStatus === "inStock" : null,
    was_price: Number.isFinite(d.wasPrice?.value) ? d.wasPrice.value : null,
    vat: d.subjectToVAT ? "subject to VAT" : "zero-rated", source: "brakes_ngstate", ref: prod.code,
  });
}

// JJ first (fast pacing), then Brakes (11s pacing per its robots.txt Crawl-delay).
for (const pair of register.pairs) {
  if (pair.plant.source !== "jj") continue;
  for (const side of ["plant", "meat"]) {
    if (blocked) break;
    await fetchJJ(pair, side);
    await sleep(1600);
  }
  if (blocked) break;
}
if (!blocked) {
  for (const pair of register.pairs) {
    if (pair.plant.source !== "brakes") continue;
    for (const side of ["plant", "meat"]) {
      if (blocked) break;
      await fetchBrakes(pair, side);
      await sleep(11000);
    }
    if (blocked) break;
  }
}

if (blocked) {
  console.error(`FATAL: a distributor appears to be blocking this client (${blocked}). Writing nothing.`);
  process.exit(2);
}
if (failures.length >= 3) {
  console.error(`FATAL: ${failures.length} product failures. Writing nothing.\n` + failures.join("\n"));
  process.exit(1);
}
if (failures.length) console.error("WARN (continuing):\n" + failures.join("\n"));

await mkdir(new URL("./data/raw/", import.meta.url), { recursive: true });
await mkdir(new URL("./data/history/", import.meta.url), { recursive: true });
await writeFile(new URL(`./data/raw/${runDate}_wholesale.json`, import.meta.url), JSON.stringify(rows, null, 2));

// History: flat rows, upsert per date. Refuse to overwrite a corrupt file.
const histPath = new URL("./data/history/history_wholesale.json", import.meta.url);
let hist = [];
try {
  hist = JSON.parse(await readFile(histPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw new Error(`history_wholesale.json unreadable; refusing to overwrite: ${e.message}`);
}
hist = hist.filter(r => r.date !== runDate);
hist.push(...rows);
hist.sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1)
  : a.pair_id !== b.pair_id ? a.pair_id.localeCompare(b.pair_id)
  : a.side.localeCompare(b.side));
await writeFile(histPath, JSON.stringify(hist, null, 1));

// CSV mirror for download.
const cols = ["date", "pair_id", "category", "distributor", "side", "label", "price_gbp", "per100", "unit", "amount", "pack_size", "price_basis", "branch_min", "branch_max", "in_stock", "was_price", "vat", "source", "ref"];
const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
await writeFile(new URL("./data/history/history_wholesale.csv", import.meta.url),
  cols.join(",") + "\n" + hist.map(r => cols.map(c => esc(r[c])).join(",")).join("\n") + "\n");

const dates = new Set(hist.map(r => r.date));
console.log(`OK: ${rows.length} wholesale rows on ${runDate} (${failures.length} product failures); history now ${hist.length} rows across ${dates.size} date(s).`);
