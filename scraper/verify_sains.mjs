// Cross-check the Sainsbury's rows against Sainsbury's own product API
// (primary source): name, retail price, unit price per kg/l.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-GB" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  "cumberland shroomdogs",
  "butcher's choice cumberland sausages",
  "plant pioneers meat free burgers",
  "quarter pounder beef burgers",
  "plant pioneers vegan mayo",
  "mayonnaise squeezy",
];

for (const q of QUERIES) {
  const u = "https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter[keyword]=" + encodeURIComponent(q);
  const r = await fetch(u, { headers: H });
  const j = await r.json();
  console.log(`\n### ${q} (${(j.products || []).length} results)`);
  for (const p of (j.products || []).slice(0, 5)) {
    console.log(`  ${p.name} | £${p.retail_price?.price} | unit £${p.unit_price?.price}/${p.unit_price?.measure}`);
  }
  await sleep(400);
}
