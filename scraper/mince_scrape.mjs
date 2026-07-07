// Snapshot scrape for the mince + meatballs additions (same method as final_scrape.mjs).
import { writeFile } from "node:fs/promises";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REGISTER = [
  ["tesco-mince", "mince", "Tesco", "plant", "/product/the-plant-chef-meat-free-mince/DCB362"],
  ["tesco-mince", "mince", "Tesco", "meat", "/product/tesco-beef-mince-20-fat/IXP556"],
  ["sains-mince", "mince", "Sainsbury's", "plant", "/product/plant-pioneers-meat-free-mince/RCV168"],
  ["sains-mince", "mince", "Sainsbury's", "meat", "/product/sainsburys-british-or-irish-20-fat-beef-mince/DVD208"],
  ["asda-mince", "mince", "Asda", "plant", "/product/plant-based-by-asda-vegan-meat-free-mince/DWD378"],
  ["asda-mince", "mince", "Asda", "meat", "/product/asda-butchers-selection-beef-mince-typically-less-than-20-fat/IPA272"],
  ["tesco-balls", "meatballs", "Tesco", "plant", "/product/tesco-plant-chef-12-meat-free-balls/MUL034"],
  ["tesco-balls", "meatballs", "Tesco", "meat", "/product/tesco-24-beef-meatballs/KLB802"],
  ["sains-balls", "meatballs", "Sainsbury's", "plant", "/product/plant-pioneers-meat-free-meatballs/IMW961"],
  ["sains-balls", "meatballs", "Sainsbury's", "meat", "/product/sainsburys-british-or-irish-10-fat-12-beef-meatballs/QQH540"],
  ["wait-balls", "meatballs", "Waitrose", "plant", "/product/waitrose-plantliving-no-meat-vegetarian-meatballs/DOX009"],
  ["wait-balls", "meatballs", "Waitrose", "meat", "/product/waitrose-12-british-beef-meatballs/IRF192"],
];

function decodeEnt(s) { return s.replace(/&pound;/g, "£").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"'); }
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
    out.push({ store, price_text: price ? decodeEnt(price).trim() : null, per_unit_text: per ? decodeEnt(per).trim() : null, offer: offer ? decodeEnt(offer).trim() : null });
  }
  return out;
}

const results = [];
for (const [pair_id, category, chain, side, slug] of REGISTER) {
  try {
    const r = await fetch("https://www.trolley.co.uk" + slug, { headers: H });
    const h = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status);
    const title = decodeEnt((h.match(/<title[^>]*>([^<]+)/) || [])[1] || "").replace(" - Compare Prices & Where To Buy", "").replace(" - Trolley.co.uk", "").trim();
    const stores = parseStores(h);
    console.log(`${pair_id}/${side}: ${title}`);
    for (const s of stores) console.log(`    ${s.store}: ${s.price_text} | ${s.per_unit_text} | offer=${s.offer || "-"}`);
    results.push({ pair_id, category, chain, side, slug, title, stores });
    await sleep(500);
  } catch (e) {
    console.log(`FAIL ${pair_id}/${side}: ${e.message}`);
    results.push({ pair_id, category, chain, side, slug, error: e.message });
    await sleep(1000);
  }
}
await writeFile(new URL("./mince_data.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(`\nSaved ${results.length} records.`);
