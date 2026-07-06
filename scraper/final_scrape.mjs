// Final prototype snapshot scrape: hand-curated pair register with explicit
// Trolley slugs. Extracts per-store price blocks; per-100g/ml is computed later
// from hand-verified pack sizes (Trolley's own per-unit strings are wrong for
// "N x W" multipacks). Output: final_data.json
import { writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [pair_id, category, chain, side, slug]
const REGISTER = [
  // Own-brand sausages
  ["tesco-saus", "sausages", "Tesco", "plant", "/product/tesco-plant-chef-6-cumberland-style-meat-free-bangers/ZDO772"],
  ["tesco-saus", "sausages", "Tesco", "meat", "/product/tesco-8-brtish-pork-sausages/ZWA592"],
  ["sains-saus", "sausages", "Sainsbury's", "plant", "/product/plant-pioneers-cumberland-shroomdogs/AOQ715"],
  ["sains-saus", "sausages", "Sainsbury's", "meat", "/product/sainsburys-butchers-choice-cumberland-british-pork-sausage/IEQ033"],
  ["wait-saus", "sausages", "Waitrose", "plant", "/product/waitrose-plant-living-no-chorizo-sausages/EHQ919"],
  ["wait-saus", "sausages", "Waitrose", "meat", "/product/waitrose-6-chorizo-sausages/FMK179"],
  ["coop-saus", "sausages", "Co-op", "plant", "/product/co-op-gro-sizzlin-sausages/TGQ766"],
  ["coop-saus", "sausages", "Co-op", "meat", "/product/co-op-outdoor-bred-8-butchers-choice-pork-sausages/UWM179"],
  // Own-brand burgers
  ["tesco-burg", "burgers", "Tesco", "plant", "/product/tesco-plant-chef-2-meat-free-burgers/VGZ971"],
  ["tesco-burg", "burgers", "Tesco", "meat", "/product/tesco-8-beef-burgers/URQ780"],
  ["asda-burg", "burgers", "Asda", "plant", "/product/plant-based-by-asda-4-veggie-burgers/GAG509"],
  ["asda-burg", "burgers", "Asda", "meat", "/product/asda-succulent-4-quarter-pounder-beef-burgers/MOA632"],
  ["sains-burg", "burgers", "Sainsbury's", "plant", "/product/plant-pioneers-meat-free-burgers/AZY903"],
  ["sains-burg", "burgers", "Sainsbury's", "meat", "/product/sainsburys-quarter-pounder-british-beef-burgers/DUP261"],
  ["wait-burg", "burgers", "Waitrose", "plant", "/product/waitrose-plantliving-2-ultimate-no-meat-vegetarian-burgers/ACR154"],
  ["wait-burg", "burgers", "Waitrose", "meat", "/product/waitrose-bbq-4-oak-smoked-beef-burgers/KHQ589"],
  ["coop-burg", "burgers", "Co-op", "plant", "/product/co-op-gro-the-incredible-burger/JIA309"],
  ["coop-burg", "burgers", "Co-op", "meat", "/product/co-op-british-4-beef-quarter-pounder-burgers/QLC428"],
  // Own-brand + branded mayonnaise
  ["sains-mayo", "mayonnaise", "Sainsbury's", "plant", "/product/plant-pioneers-vegan-mayo/KHD660"],
  ["sains-mayo", "mayonnaise", "Sainsbury's", "meat", "/product/sainsburys-mayonnaise-squeezy/RYF474"],
  ["hellmanns-mayo", "mayonnaise", "Hellmann's (branded)", "plant", "/product/hellmanns-plant-based-mayo/GCM325"],
  ["hellmanns-mayo", "mayonnaise", "Hellmann's (branded)", "meat", "/product/hellmanns-real-mayonnaise/FOQ118"],
  ["heinz-mayo", "mayonnaise", "Heinz (branded)", "plant", "/product/heinz-seriously-good-vegan-mayonnaise/OGD694"],
  ["heinz-mayo", "mayonnaise", "Heinz (branded)", "meat", "/product/heinz-seriously-good-mayonnaise/SFX180"],
  // Branded sausages + ice cream
  ["richmond-saus", "branded", "Richmond (branded)", "plant", "/product/richmond-8-vegan-meat-free-sausages/ULY095"],
  ["richmond-saus", "branded", "Richmond (branded)", "meat", "/product/richmond-8-thick-pork-sausages/KAT162"],
  ["magnum-ice", "branded", "Magnum (branded)", "plant", "/product/magnum-vegan-classic-3mp/PAN815"],
  ["magnum-ice", "branded", "Magnum (branded)", "meat", "/product/magnum-ice-cream-sticks-classic-3x100/VIT009"],
];

function decodeEnt(s) {
  return s.replace(/&pound;/g, "£").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"');
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
      price_text: price ? decodeEnt(price).trim() : null,
      per_unit_text: per ? decodeEnt(per).trim() : null,
      offer: offer ? decodeEnt(offer).trim() : null,
    });
  }
  return out;
}

// For missing-price diagnostics, dump a chunk of the raw item block.
function rawItemBlocks(html) {
  return html.split('<div class="_item">').slice(1).map(b => b.slice(0, 1200));
}

const results = [];
for (const [pair_id, category, chain, side, slug] of REGISTER) {
  try {
    const r = await fetch("https://www.trolley.co.uk" + slug, { headers: H });
    const h = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status);
    const title = decodeEnt((h.match(/<title[^>]*>([^<]+)/) || [])[1] || "")
      .replace(" - Compare Prices & Where To Buy", "").replace(" - Trolley.co.uk", "").trim();
    const stores = parseStores(h);
    console.log(`${pair_id}/${side}: ${title}`);
    for (const s of stores) console.log(`    ${s.store}: ${s.price_text} | ${s.per_unit_text} | offer=${s.offer || "-"}`);
    if (stores.some(s => !s.price_text)) {
      console.log("    RAW (first block):", rawItemBlocks(h)[0].replace(/\s+/g, " ").slice(0, 600));
    }
    results.push({ pair_id, category, chain, side, slug, title, stores });
    await sleep(500);
  } catch (e) {
    console.log(`FAIL ${pair_id}/${side}: ${e.message}`);
    results.push({ pair_id, category, chain, side, slug, error: e.message });
    await sleep(1000);
  }
}
await writeFile(new URL("./final_data.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(`\nSaved ${results.length} records.`);
