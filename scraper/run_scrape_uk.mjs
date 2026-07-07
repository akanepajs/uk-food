// Daily UK plant-vs-meat price scrape. Walks the curated register in pairs.json:
// one trolley.co.uk /product/ page per product (robots-compliant; /search/ is not
// used), plus Sainsbury's own product API as the primary source for Sainsbury's
// rows where the register carries a query. Computes per-100g/ml from the
// register's hand-verified pack amounts (the aggregator's own multipack unit
// prices are wrong: it multiplies pack count by total weight), writes a dated raw
// snapshot, and appends to the flat history series (upsert per date).
//
// Fail-loud policy (mirrors olas): a bot-block signal (403/429/challenge) or 3+
// product failures aborts without writing, so a transient outage never lands in
// the history as a fake price gap and the prior committed page stays live.
//
// Usage: node run_scrape_uk.mjs [run-date YYYY-MM-DD]

import { mkdir, readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const runDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const register = JSON.parse(await readFile(new URL("./pairs.json", import.meta.url), "utf8"));
const ALLOWED = new Set(register.allowed_stores);

function decodeEnt(s) {
  return s.replace(/&pound;/g, "£").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"');
}
function parsePrice(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}
// "£0.42 per 100g" -> 0.42 (fallback when the register has no pack amount;
// single-container products only, where the aggregator's figure is reliable).
function parsePerUnit(text) {
  const m = String(text || "").match(/£\s?(\d+(?:\.\d+)?)\s*per\s*100\s*(g|ml)/i);
  return m ? Number(m[1]) : null;
}
function parseStores(html) {
  const items = html.split('<div class="_item">').slice(1);
  const out = [];
  for (const it of items) {
    const store = (it.match(/<svg title="([^"]+)" class="store-logo/) || [])[1];
    if (!store) continue;
    let price = (it.match(/<div class="_price"><b>([^<]+)<\/b>/) || [])[1];
    if (!price) price = (it.match(/£\s?\d+(?:\.\d{2})?|&pound;\d+(?:\.\d{2})?/) || [])[0];
    const per = (it.match(/<div class="_per-item[^"]*">([^<]+)/) || [])[1];
    const offer = (it.match(/<div class="_product-offer">([^<]+)/) || [])[1];
    out.push({
      store,
      price: price ? parsePrice(decodeEnt(price)) : null,
      per_unit_text: per ? decodeEnt(per).trim() : null,
      offer: offer ? decodeEnt(offer).trim() : null,
    });
  }
  return out;
}
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

let blocked = null;
const failures = [];
const rows = [];

async function fetchTrolley(pair, side) {
  const prod = pair[side];
  const url = "https://www.trolley.co.uk" + prod.slug;
  const r = await fetch(url, { headers: H });
  if (r.status === 403 || r.status === 429) { blocked = `HTTP ${r.status} on ${prod.slug}`; return; }
  if (!r.ok) { failures.push(`${pair.pair_id}/${side}: HTTP ${r.status}`); return; }
  const html = await r.text();
  if (/cf-challenge|Attention Required!|just a moment/i.test(html.slice(0, 3000))) {
    blocked = `challenge page on ${prod.slug}`; return;
  }
  const stores = parseStores(html).filter(s => ALLOWED.has(s.store));
  if (!stores.length) { failures.push(`${pair.pair_id}/${side}: no store rows parsed`); return; }
  const excl = new Set(pair.exclude_stores || []);
  for (const s of stores) {
    if (excl.has(s.store)) continue;
    if (s.price == null) continue;
    const per100 = prod.amount
      ? Number((s.price / prod.amount * 100).toFixed(4))
      : parsePerUnit(s.per_unit_text);
    rows.push({
      date: runDate, pair_id: pair.pair_id, category: pair.category, chain: pair.chain,
      side, store: s.store, label: prod.label, price_gbp: s.price, per100, unit: prod.unit,
      offer: s.offer || null, source: "trolley",
      amount: prod.amount, amount_basis: prod.amount ? "register" : "aggregator_per_unit",
    });
  }
}

async function sainsburysApi(pair, side) {
  const prod = pair[side];
  if (!prod.sains_api) return;
  try {
    const u = "https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter[keyword]="
      + encodeURIComponent(prod.sains_api.query);
    const r = await fetch(u, { headers: { ...H, "Accept": "application/json" } });
    if (!r.ok) return; // silent: aggregator row stands, provenance stays "trolley"
    const j = await r.json();
    const want = norm(prod.sains_api.name);
    const hit = (j.products || []).find(p => norm(p.name).includes(want));
    if (!hit || !hit.retail_price) return;
    let per100 = null;
    const up = hit.unit_price;
    if (up && up.price != null) {
      if (/^(kg|ltr|l)$/i.test(up.measure)) per100 = Number((up.price / 10).toFixed(4));
      else if (/^100\s?(g|ml)$/i.test(up.measure)) per100 = Number(up.price.toFixed(4));
    }
    if (per100 == null && prod.amount) per100 = Number((hit.retail_price.price / prod.amount * 100).toFixed(4));
    if (per100 == null) return;
    // Replace the aggregator's Sainsbury's row for this product with the primary source.
    const i = rows.findIndex(x => x.pair_id === pair.pair_id && x.side === side && x.store === "Sainsbury's");
    const rec = {
      date: runDate, pair_id: pair.pair_id, category: pair.category, chain: pair.chain,
      side, store: "Sainsbury's", label: prod.label, price_gbp: hit.retail_price.price, per100,
      unit: prod.unit, offer: null, source: "sainsburys_api",
      amount: prod.amount, amount_basis: "retailer_api", api_name: hit.name,
    };
    if (i >= 0) rows[i] = rec; else rows.push(rec);
  } catch { /* API is an upgrade, not a dependency */ }
}

for (const pair of register.pairs) {
  for (const side of ["plant", "meat"]) {
    if (blocked) break;
    await fetchTrolley(pair, side);
    await sleep(600);
  }
  if (blocked) break;
}
if (!blocked) {
  for (const pair of register.pairs) {
    for (const side of ["plant", "meat"]) {
      await sainsburysApi(pair, side);
      await sleep(300);
    }
  }
}

if (blocked) {
  console.error(`FATAL: aggregator appears to be blocking this client (${blocked}). Writing nothing.`);
  process.exit(2);
}
if (failures.length >= 3) {
  console.error(`FATAL: ${failures.length} product failures. Writing nothing.\n` + failures.join("\n"));
  process.exit(1);
}
if (failures.length) console.error("WARN (continuing):\n" + failures.join("\n"));

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
hist = hist.filter(r => r.date !== runDate);
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
console.log(`Sainsbury's API rows this run: ${rows.filter(r => r.source === "sainsburys_api").length}`);
