// Build index.html for uk-food.kanepajs.eu from the pair register and the price
// history. Numbers on the page come only from scraper/data/history/history.json
// so text always matches data. Ratios are averages of daily prices over the
// whole series (the Which? 2022 benchmark used a 3-month average); latest-date
// prices are shown in the tables. No em dashes (outward-facing, Art's name).
//
// Usage: node scripts/build_page.mjs

import { readFile, writeFile } from "node:fs/promises";

const register = JSON.parse(await readFile(new URL("../scraper/pairs.json", import.meta.url), "utf8"));
const hist = JSON.parse(await readFile(new URL("../scraper/data/history/history.json", import.meta.url), "utf8"));
let whist = [], wreg = { pairs: [] };
try {
  wreg = JSON.parse(await readFile(new URL("../scraper/pairs_wholesale.json", import.meta.url), "utf8"));
  whist = JSON.parse(await readFile(new URL("../scraper/data/history/history_wholesale.json", import.meta.url), "utf8"));
} catch { /* wholesale layer optional: section is omitted if data absent */ }
// Bidfood is account-gated, so its prices are a hand-curated static snapshot
// (see pairs_bidfood_static.json), rendered as its own table; never scraped.
let bidreg = null;
try {
  bidreg = JSON.parse(await readFile(new URL("../scraper/pairs_bidfood_static.json", import.meta.url), "utf8"));
} catch { /* Bidfood snapshot optional */ }

// Research-page numbers come ONLY from research_data.json, written by the procurement
// project's verify_research_data.py after asserting every value against the Springmann
// supplementary dataset (mmc3) and the procurement evidence register. Do not hand-edit
// the JSON; re-run that script instead.
const RD = JSON.parse(await readFile(new URL("./research_data.json", import.meta.url), "utf8"));

const dates = [...new Set(hist.map(r => r.date))].sort();
const firstDate = dates[0], lastDate = dates[dates.length - 1], nDates = dates.length;
const latest = hist.filter(r => r.date === lastDate);

const fmtD = iso => { const [y, m, d] = iso.split("-"); return `${Number(d)} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${y}`; };
const f2 = v => v == null ? "-" : v.toFixed(2);
const fr = v => v == null ? "-" : `${(Math.round(v * 10) / 10).toFixed(1)}x`;

// chain name -> store name carrying that chain's own-brand products
const chainStore = c => c === "M&S (Ocado)" ? "Ocado" : c;

function rowsFor(pairId, side, store, from = hist) {
  return from.filter(r => r.pair_id === pairId && r.side === side && (!store || r.store === store));
}
// Average ratio over all dates for a pair at one store.
function avgRatio(pairId, store) {
  const per = {};
  for (const d of dates) {
    const p = hist.find(r => r.date === d && r.pair_id === pairId && r.side === "plant" && r.store === store);
    const m = hist.find(r => r.date === d && r.pair_id === pairId && r.side === "meat" && r.store === store);
    if (p && m && p.per100 && m.per100) per[d] = p.per100 / m.per100;
  }
  const v = Object.values(per);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function latestSide(pairId, side, store) {
  return latest.find(r => r.pair_id === pairId && r.side === side && r.store === store) || null;
}

// ---- assemble own-brand pair rows ----
const OWN_CATS = ["sausages", "burgers", "mince", "meatballs", "ready meals", "coleslaw", "mayonnaise"];
const own = {};
for (const cat of OWN_CATS) own[cat] = [];
for (const pair of register.pairs) {
  if (pair.chain === "branded") continue;
  const store = chainStore(pair.chain);
  const p = latestSide(pair.pair_id, "plant", store);
  const m = latestSide(pair.pair_id, "meat", store);
  if (!p || !m || !p.per100 || !m.per100) continue;
  own[pair.category].push({
    pair, store, p, m,
    ratio: p.per100 / m.per100,
    avg: avgRatio(pair.pair_id, store),
    verified: (p.source === "sainsburys_api") && (m.source === "sainsburys_api"),
  });
}
for (const cat of OWN_CATS) own[cat].sort((a, b) => b.ratio - a.ratio);

// branded pairs: per-store rows where both sides priced
function brandedRows(pairId) {
  const stores = [...new Set(latest.filter(r => r.pair_id === pairId).map(r => r.store))];
  const out = [];
  for (const s of stores) {
    const p = latestSide(pairId, "plant", s), m = latestSide(pairId, "meat", s);
    if (p && m && p.per100 && m.per100) out.push({ store: s, p, m, ratio: p.per100 / m.per100, avg: avgRatio(pairId, s) });
  }
  out.sort((a, b) => a.ratio - b.ratio);
  return out;
}
function brandedRange(pairId, side) {
  const v = latest.filter(r => r.pair_id === pairId && r.side === side && r.per100).map(r => r.per100);
  if (!v.length) return "-";
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? f2(lo) : `${f2(lo)}-${f2(hi)}`;
}
function ratioRange(rows) {
  if (!rows.length) return "-";
  const v = rows.map(r => r.ratio);
  const lo = fr(Math.min(...v)), hi = fr(Math.max(...v));
  return lo === hi ? lo : `${lo}-${hi}`;
}

// ---- static config: Which? 2022 benchmark + per-category notes ----
const TREND = [
  { key: "sausages", pairs: [
    { pair_id: "tesco-saus", label: "Tesco", p22: 0.56, m22: 0.33, flag: false, tlabel: "Tesco sausages: Plant Chef Cumberland bangers vs pork sausages" },
    { pair_id: "sains-saus", label: "Sainsbury's", p22: 0.81, m22: 0.42, flag: false, tlabel: "Sainsbury's sausages: Shroomdogs vs Butcher's Choice Cumberland" },
    { pair_id: "wait-saus", label: "Waitrose", p22: 1.08, m22: 0.45, flag: true, tlabel: "Waitrose sausages *" },
    { pair_id: "coop-saus", label: "Co-op", p22: 0.53, m22: 0.54, flag: false, tlabel: "Co-op sausages: Sizzlin' vs Co-op pork sausages" },
  ]},
  { key: "burgers", pairs: [
    { pair_id: "tesco-burg", label: "Tesco", p22: 0.65, m22: 0.44, flag: true, tlabel: "Tesco burgers *" },
    { pair_id: "asda-burg", label: "Asda", p22: 0.96, m22: 0.67, flag: true, tlabel: "Asda burgers *" },
    { pair_id: "sains-burg", label: "Sainsbury's", p22: 0.76, m22: 0.77, flag: false, tlabel: "Sainsbury's burgers: Plant Pioneers vs quarter pounders" },
    { pair_id: "wait-burg", label: "Waitrose", p22: 1.21, m22: 0.67, flag: true, tlabel: "Waitrose burgers *" },
  ]},
];
const TREND_BRANDED = [
  { pair_id: "richmond-saus", tlabel: "Richmond sausages (range across chains)", p22: "0.72-0.84", m22: "0.50-0.55", flag: false },
  { pair_id: "ginsters-pasty", tlabel: "Ginsters pasty (range across chains)", p22: "0.88-1.11", m22: "0.64-0.86", flag: false },
  { pair_id: "hellmanns-mayo", tlabel: "Hellmann's mayo (range across chains) *", p22: "0.58-0.78", m22: "0.46-0.56", flag: true },
  { pair_id: "magnum-ice", tlabel: "Magnum (range across chains)", p22: "1.26-1.56", m22: "0.77-0.91", flag: false },
];

const NOTES = {
  "sausages": "Sainsbury's rows verified against Sainsbury's own product API. Waitrose pair is chorizo vs no-chorizo (its closest like-for-like). Morrisons and Asda excluded: no standard own-brand pork sausage (Morrisons) or own-brand plant sausage (Asda) listed on the aggregator; M&S not covered by the aggregator.",
  "burgers": "Match-quality flags: Tesco pairs a chilled plant product with frozen beef burgers; the Asda plant product is a vegetable burger rather than a meat-imitation patty (its weight is implied from the aggregator's unit price, unverified); the Waitrose pair sits in a premium tier on both sides. Sainsbury's row verified against Sainsbury's API. Morrisons has no comparable own-brand meat-imitation burger, matching the exclusion in Which? (2022).",
  "mince": "Plant mince is compared against the standard 20% fat beef mince, the cheapest standard tier; against lean 5% mince the plant discount would be larger still. Tesco and Asda plant minces are frozen against chilled beef. Morrisons, Waitrose and Co-op list no own-brand plant mince.",
  "meatballs": "The Tesco pair is frozen on both sides but 12 balls vs a 24-ball pack. Sainsbury's rows verified against Sainsbury's API (its 5% fat variant is more expensive, which would push the ratio lower still). Morrisons and Co-op list no own-brand plant meatballs.",
  "ready meals": "The Which? (2022) ready-meal pairs at Tesco (cottage pie) and Waitrose (moussaka) are no longer listed on the aggregator, so the category currently covers Sainsbury's (lasagne vs lasagne) and Co-op (the same curry pair Which? used). Note the Co-op pair compares a cauliflower curry with a chicken curry: a like-for-like dish, not a like-for-like protein swap.",
  "coleslaw": "Vegan coleslaw differs from standard mainly in the dressing (no egg/cream). Sainsbury's pair is deli-style vs deli-style at the same 300g size, both API-verified. M&S Plant Kitchen coleslaw exists via Ocado but its pack weights cannot be verified on the aggregator (its unit prices there imply implausible pack sizes), so M&S is excluded. Morrisons lists no standard own-brand coleslaw on the aggregator.",
  "mayonnaise": "Pack sizes differ within the Sainsbury's own-brand and Hellmann's pairs (smaller packs usually cost more per 100ml, so those ratios partly reflect pack size). Heinz sells both versions at the same 775g size. A Waitrose listing for the standard Heinz was excluded as a suspected stale or promotional record.",
};

const CAT_HEADINGS = {
  "sausages": ["Sausages: own-brand plant vs pork", "Pork product"],
  "burgers": ["Burgers: own-brand plant vs beef", "Beef product"],
  "mince": ["Mince: own-brand plant vs beef", "Beef product"],
  "meatballs": ["Meatballs: own-brand plant vs beef", "Beef product"],
  "ready meals": ["Ready meals: own-brand plant vs meat", "Meat product"],
  "coleslaw": ["Coleslaw: own-brand vegan vs standard", "Standard product"],
  "mayonnaise": ["Mayonnaise: own-brand vegan vs egg-based", "Standard product"],
};

// ---- HTML fragments ----
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pos = r => Math.min(98, r / 3 * 100);

function lollipop(label, ratio, valText) {
  const p = pos(ratio), par = 33.33;
  const cls = ratio > 1.005 ? "dear" : "cheap";
  const left = Math.min(p, par), width = Math.abs(p - par);
  const stem = width > 0.3 ? `<div class="stem ${cls}" style="left: ${left.toFixed(1)}%; width: ${width.toFixed(1)}%;"></div>` : "";
  return `  <div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div class="parity"></div>${stem}<div class="dot ${cls}" style="left: ${p.toFixed(1)}%;"></div></div><span class="bar-val">${valText}</span></div>`;
}
function dumbbell(label, r22, rNow) {
  const p22 = pos(r22), pN = pos(rNow);
  const cls = rNow > 1.005 ? "dear" : "cheap";
  const left = Math.min(p22, pN), width = Math.abs(p22 - pN);
  const stem = width > 0.3 ? `<div class="stem trend" style="left: ${left.toFixed(1)}%; width: ${width.toFixed(1)}%;"></div>` : "";
  return `  <div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div class="parity"></div>${stem}<div class="dot past" style="left: ${p22.toFixed(1)}%;"></div><div class="dot ${cls}" style="left: ${pN.toFixed(1)}%;"></div></div><span class="bar-val">${(Math.round(r22*10)/10).toFixed(1)}&#8594;${(Math.round(rNow*10)/10).toFixed(1)}</span></div>`;
}
const axisRow = `  <div class="axis-row"><span></span><div class="axis"><span style="left: 0%; transform: none;">0x</span><span style="left: 33.33%;">1x (parity)</span><span style="left: 66.67%;">2x</span><span style="left: 100%; transform: translateX(-100%);">3x</span></div><span></span></div>`;

function ownTable(cat) {
  const rows = own[cat];
  if (!rows.length) return "";
  const [heading, meatHead] = CAT_HEADINGS[cat];
  const avgCol = nDates >= 2;
  const unit = rows[0].p.unit === "ml" ? "£/100ml" : "£/100g";
  const body = rows.map(r => {
    return `    <tr><td class="txt">${esc(r.pair.chain)}</td><td class="txt plant">${esc(r.pair.plant.label)}${r.pair.plant.amount ? ", " + r.pair.plant.amount + r.p.unit : ""}</td><td>${f2(r.p.price_gbp)}</td><td>${f2(r.p.per100)}</td><td class="txt meat">${esc(r.pair.meat.label)}${r.pair.meat.amount ? ", " + r.pair.meat.amount + r.m.unit : ""}</td><td>${f2(r.m.price_gbp)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`;
  }).join("\n");
  return `<h2>${esc(heading)}</h2>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Chain</th><th class="txt">Plant-based product</th><th>£</th><th>${unit}</th><th class="txt">${esc(meatHead)}</th><th>£</th><th>${unit}</th><th>Ratio</th>${avgCol ? `<th>Avg ratio (${nDates}d)</th>` : ""}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>
<p class="tablenote">${NOTES[cat]}</p>`;
}

function brandedTable(pairId, title, note) {
  const rows = brandedRows(pairId);
  if (!rows.length) return "";
  const avgCol = nDates >= 2;
  const unit = rows[0].p.unit === "ml" ? "£/100ml" : "£/100g";
  const body = rows.map(r =>
    `    <tr><td class="txt">${esc(r.store)}</td><td>${f2(r.p.price_gbp)}</td><td>${f2(r.p.per100)}</td><td>${f2(r.m.price_gbp)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`).join("\n");
  return `<h3>${esc(title)}</h3>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Chain</th><th>Plant £</th><th>Plant ${unit}</th><th>Standard £</th><th>Standard ${unit}</th><th>Ratio</th>${avgCol ? `<th>Avg (${nDates}d)</th>` : ""}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>
<p class="tablenote">${note}</p>`;
}

// ---- key message (computed) ----
// "Latest picture" summary: purely factual ratio listings, no directional or interpretative
// wording (no "cheaper at every chain" / "largest premium" claims), so the sentences stay
// correct whatever the prices do (Art, 2026-07-08).
function keyMessage() {
  const seg = [];
  const rng = rs => {
    const v = rs.map(r => r.ratio);
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? fr(lo) : `${fr(lo)} to ${fr(hi)}`;
  };
  const saus = own["sausages"];
  if (saus.length) {
    const list = saus.map(r => `${r.pair.chain} ${fr(r.ratio)}`).join(", ");
    seg.push(`Own-brand plant-based sausages vs pork sausages, per 100g: ${list}.`);
  }
  const burg = own["burgers"];
  if (burg.length) seg.push(`Burgers run ${rng(burg)}.`);
  const mince = own["mince"], balls = own["meatballs"];
  if (mince.length && balls.length) {
    seg.push(`Plant mince vs standard 20% fat beef mince runs ${rng(mince)} across ${mince.length} chains with a pair; plant meatballs run ${rng(balls)}.`);
  }
  const mayo = own["mayonnaise"];
  if (mayo.length) {
    seg.push(`Own-brand vegan vs standard mayonnaise: ${fr(mayo[0].ratio)} at ${mayo[0].pair.chain}.`);
  }
  return seg.join(" ");
}

// ---- chart ----
function mainChart() {
  const out = [];
  for (const cat of OWN_CATS) {
    if (!own[cat].length) continue;
    out.push(`  <div class="grp">${esc(cat[0].toUpperCase() + cat.slice(1))} (own-brand)</div>`);
    for (const r of own[cat]) out.push(lollipop(r.pair.chain, r.avg ?? r.ratio, fr(r.avg ?? r.ratio)));
  }
  out.push(axisRow);
  return out.join("\n");
}

// ---- trend ----
function trendChart() {
  const out = [];
  for (const g of TREND) {
    out.push(`  <div class="grp">${esc(g.key[0].toUpperCase() + g.key.slice(1))} (own-brand)</div>`);
    for (const t of g.pairs) {
      const row = own[g.key].find(r => r.pair.pair_id === t.pair_id);
      if (!row) continue;
      const rNow = row.avg ?? row.ratio;
      out.push(dumbbell(t.label + (t.flag ? " *" : ""), t.p22 / t.m22, rNow));
    }
  }
  out.push(axisRow);
  return out.join("\n");
}
function trendTable() {
  const rows = [];
  for (const g of TREND) for (const t of g.pairs) {
    const row = own[g.key].find(r => r.pair.pair_id === t.pair_id);
    if (!row) continue;
    rows.push(`    <tr><td class="txt">${esc(t.tlabel)}</td><td>${f2(t.p22)}</td><td>${f2(row.p.per100)}</td><td>${f2(t.m22)}</td><td>${f2(row.m.per100)}</td><td>${fr(t.p22 / t.m22)}</td><td class="ratio">${fr(row.avg ?? row.ratio)}</td></tr>`);
  }
  for (const t of TREND_BRANDED) {
    const br = brandedRows(t.pair_id);
    if (!br.length) continue;
    rows.push(`    <tr><td class="txt">${esc(t.tlabel)}</td><td>${t.p22}</td><td>${brandedRange(t.pair_id, "plant")}</td><td>${t.m22}</td><td>${brandedRange(t.pair_id, "meat")}</td><td colspan="2" class="ratio">now ${ratioRange(br)} by chain</td></tr>`);
  }
  return rows.join("\n");
}

// ---- wholesale (foodservice) section ----
const wdates = [...new Set(whist.map(r => r.date))].sort();
const wLast = wdates[wdates.length - 1];
const wLatest = whist.filter(r => r.date === wLast);
const wnDates = wdates.length;

function wAvgRatio(pairId) {
  const v = [];
  for (const d of wdates) {
    const p = whist.find(r => r.date === d && r.pair_id === pairId && r.side === "plant");
    const m = whist.find(r => r.date === d && r.pair_id === pairId && r.side === "meat");
    if (p && m && p.per100 && m.per100) v.push(p.per100 / m.per100);
  }
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function wholesaleRows() {
  const out = [];
  for (const pair of wreg.pairs) {
    const p = wLatest.find(r => r.pair_id === pair.pair_id && r.side === "plant");
    const m = wLatest.find(r => r.pair_id === pair.pair_id && r.side === "meat");
    if (!p || !m || !p.per100 || !m.per100) continue;
    out.push({ pair, p, m, ratio: p.per100 / m.per100, avg: wAvgRatio(pair.pair_id) });
  }
  return out;
}

// Wholesale "Latest picture" summary: purely factual ratio ranges, no directional wording
// (same rule as the retail keyMessage; Art, 2026-07-08), so it stays correct as prices move.
function wKeyMessage() {
  const rows = wholesaleRows();
  if (!rows.length) return "";
  const seg = [];
  const by = cat => rows.filter(r => r.pair.category.toLowerCase().includes(cat));
  const rng = rs => {
    const v = rs.map(r => r.avg ?? r.ratio);
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? fr(lo) : `${fr(lo)} to ${fr(hi)}`;
  };
  const mb = [...by("mince"), ...by("meatball")];
  if (mb.length) seg.push(`Plant-based mince and meatballs run ${rng(mb)}.`);
  const saus = by("sausage");
  if (saus.length) seg.push(`Plant-based sausages run ${rng(saus)}.`);
  const burg = by("burger");
  if (burg.length) seg.push(`Burgers run ${rng(burg)} (see the pair notes: the JJ pair compares coated chicken formats).`);
  const mayo = by("mayo");
  if (mayo.length) seg.push(`Same-brand vegan mayonnaise runs ${rng(mayo)}.`);
  const otherSB = rows.filter(r => r.pair.same_brand && !r.pair.category.toLowerCase().includes("mayo"));
  if (otherSB.length) seg.push(`The other same-brand pairs (${[...new Set(otherSB.map(r => r.pair.category))].join(", ")}) run ${rng(otherSB)}.`);
  return seg.join(" ");
}

// Bidfood static snapshot rows (account-gated portal; hand-curated, not scraped).
// RATIOS ONLY: Bidfood's trading terms treat specific pricing as confidential,
// so the public register carries no prices; the price-bearing source register
// lives in the private procurement project.
function bidfoodRows() {
  if (!bidreg) return [];
  return bidreg.pairs.map(pair => ({ pair, ratio: pair.ratio }));
}

function wholesaleSection() {
  const rows = wholesaleRows();
  if (!rows.length) return "";
  const avgCol = wnDates >= 2;
  const priceCell = r => f2(r.price_gbp) + (r.was_price ? "&nbsp;*" : "");
  const distTable = dist => {
    const drows = rows.filter(r => r.pair.distributor === dist);
    if (!drows.length) return "";
    const units = new Set(drows.map(r => r.p.unit));
    const mixed = units.size > 1;
    const unitHead = mixed ? "&pound;/100g or &pound;/100ml" : (units.has("ml") ? "&pound;/100ml" : "&pound;/100g");
    const catCell = r => esc(r.pair.category) + (r.pair.same_brand ? " &middot; same brand" : "") + (mixed && r.p.unit === "ml" ? " (per 100ml)" : "");
    const body = drows.map(r =>
      `    <tr><td class="txt">${catCell(r)}</td><td class="txt plant">${esc(r.pair.plant.label)}</td><td>${priceCell(r.p)}</td><td>${f2(r.p.per100)}</td><td class="txt meat">${esc(r.pair.meat.label)}</td><td>${priceCell(r.m)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`).join("\n");
    return `<h2>${esc(dist)}</h2>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Category</th><th class="txt">Plant-based product</th><th>&pound;</th><th>${unitHead}</th><th class="txt">Meat or standard product</th><th>&pound;</th><th>${unitHead}</th><th>Ratio</th>${avgCol ? `<th>Avg (${wnDates}d)</th>` : ""}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>`;
  };
  const brows = bidfoodRows();
  const chart = [];
  for (const dist of ["JJ Foodservice", "Brakes"]) {
    const drows = rows.filter(r => r.pair.distributor === dist);
    if (!drows.length) continue;
    chart.push(`  <div class="grp">${esc(dist)}</div>`);
    for (const r of [...drows].sort((a, b) => b.ratio - a.ratio)) {
      chart.push(lollipop(r.pair.category, r.avg ?? r.ratio, fr(r.avg ?? r.ratio)));
    }
  }
  if (brows.length) {
    chart.push(`  <div class="grp">Bidfood (snapshot)</div>`);
    for (const r of [...brows].sort((a, b) => b.ratio - a.ratio)) {
      chart.push(lollipop(r.pair.category, r.ratio, fr(r.ratio)));
    }
  }
  chart.push(axisRow);
  const bidTable = () => {
    if (!brows.length) return "";
    const catCell = r => esc(r.pair.category) + (r.pair.same_brand ? " &middot; same brand" : "");
    const body = brows.map(r =>
      `    <tr><td class="txt">${catCell(r)}</td><td class="txt plant">${esc(r.pair.plant.label)}</td><td class="txt meat">${esc(r.pair.meat.label)}</td><td class="ratio">${fr(r.ratio)}</td></tr>`).join("\n");
    return `<h2>Bidfood (account-gated: one-day snapshot, ${esc(fmtD(bidreg.snapshot_date))})</h2>
<p>Bidfood's ordering portal requires a trade account, so unlike JJ and Brakes its prices cannot be tracked daily, and its trading terms treat specific pricing as confidential, so the rows below show only the price ratio of each pair, not the underlying prices. Ratios come from a hand-curated snapshot taken through a trade account on ${esc(fmtD(bidreg.snapshot_date))}: ex-VAT wholesale list prices as shown to a new account, not the negotiated prices a contract caterer pays.</p>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Category</th><th class="txt">Plant-based product</th><th class="txt">Meat or standard product</th><th>Ratio, plant / meat per 100g or 100ml</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>`;
  };
  const noteRows = wreg.pairs.filter(pr => rows.some(r => r.pair.pair_id === pr.pair_id) && pr.note)
    .map(pr => `<li><strong>${esc(pr.pair_id)}</strong> (${esc(pr.distributor)}, ${esc(pr.category)}): ${esc(pr.note)}</li>`).join("\n  ");
  const bidNoteRows = brows.filter(r => r.pair.note)
    .map(r => `<li><strong>${esc(r.pair.pair_id)}</strong> (Bidfood, ${esc(r.pair.category)}): ${esc(r.pair.note)}</li>`).join("\n  ");
  return `<p>Public-sector and contract caterers buy at wholesale, not retail, so this page tracks the same plant-vs-meat comparison at UK foodservice distributors: <a href="https://www.jjfoodservice.com">JJ Foodservice</a> (cash-and-carry and delivered wholesale) and <a href="https://www.brake.co.uk">Brakes</a> (contract-catering distribution), whose product prices are publicly visible without an account and scraped daily, plus <a href="https://www.bidfood.co.uk">Bidfood</a> (contract-catering distribution), whose account-gated prices appear only as ratios in a one-day snapshot below. Rows marked "same brand" compare a brand's own plant-based line against its animal-product line.</p>
<div class="legend">Dot = ratio of plant-based price per 100g/100ml to the meat or standard equivalent, averaged (Bidfood: single-day snapshot).
  <span class="swatch" style="background: var(--pink);"></span>plant-based costs more
  <span class="swatch" style="background: var(--sage);"></span>plant-based cheaper or equal
</div>
<div class="chart">
${chart.join("\n")}
</div>
${distTable("JJ Foodservice")}
${distTable("Brakes")}
<p class="tablenote">Prices marked * were on promotion at scrape time (the regular price is recorded in the data as was_price).</p>
${bidTable()}
<h2>Wholesale method notes</h2>
<ul class="checklist">
  <li><strong>Price basis differs from retail and between distributors.</strong> JJ Foodservice prices are ex-VAT Collection prices at the Enfield branch (its product pages publish every branch's price; the data records the min-max across branches). Brakes shows an anonymous indicative price based on an "average customer discount": a real caterer's negotiated contract price can differ, so treat Brakes figures as indicative list-level prices, not transaction prices. Bidfood ratios are computed from ex-VAT list prices shown to a new trade account on the snapshot date; the specific prices are withheld because Bidfood's trading terms treat them as confidential. Ratios within a distributor are internally consistent.</li>
  <li><strong>Catering pack formats:</strong> per-100g/100ml figures are computed from each product's stated pack weight or volume (recorded in the register and cross-checked against the distributor's own per-kg unit price where published and where its basis is consistent; the register documents one Brakes bulk-mayonnaise case where the published per-litre figures mix a mass and a volume basis). Pack sizes differ within some pairs; the pair notes flag where that matters.</li>
  <li><strong>Range gaps are themselves a finding.</strong> JJ lists 28 beef burger lines and no beef-style plant burger (its plant burgers are vegetable or coated chicken-style, so the JJ burger pair compares coated chicken formats). Neither JJ nor Brakes lists a vegan coleslaw. At the July 2026 same-brand sweep, JJ carried no Richmond, no vegan Pukka pie and no Magnum; Brakes carried no Richmond and no Ginsters; and no brand sells both cow milk and a plant drink at either. The wholesale plant-based assortment is far thinner than retail.</li>
  <li><strong>No published wholesale benchmark exists for plant-based products.</strong> AHDB publishes weekly GB deadweight (carcase) price series for <a href="https://ahdb.org.uk/beef/gb-deadweight-cattle-prices">cattle</a> and <a href="https://ahdb.org.uk/pork/gb-deadweight-pig-prices-eu-spec">pigs</a>, but a carcase price is a farm-gate commodity price, not comparable to a catering product, and no plant-based equivalent series exists anywhere in its taxonomy.</li>
  <li><strong>Scrape conduct:</strong> JJ and Brakes are scraped as anonymous visitors from their server-rendered product pages, within each site's robots.txt (Brakes sets a 10-second crawl delay and a 04:00-08:45 UTC visit window; the daily run is paced and scheduled accordingly). Bidfood is not scraped: its snapshot was curated by hand through a trade account.</li>
</ul>
<h2>Pair matching notes (wholesale)</h2>
<ul class="checklist">
  ${noteRows}
  ${bidNoteRows}
</ul>`;
}

// ---- shared page chrome ----
// Research is the landing page (Art, 07-07): index.html = research, retail.html = retail;
// research.html is kept as a redirect stub so earlier links do not break.
const tabs = active => `<div class="tabs"><a href="./" class="tab${active === "research" ? " active" : ""}">Research</a><a href="retail.html" class="tab${active === "retail" ? " active" : ""}">Retail (supermarkets)</a><a href="wholesale.html" class="tab${active === "wholesale" ? " active" : ""}">Wholesale (foodservice)</a></div>`;

const STYLE = `
  :root {
    --teal: #88a8a8; --olive: #889880; --pink: #c890a0; --ochre: #e0c868;
    --mint: #c8e8e0; --sage: #c0d0a9; --burgundy: #744c5b;
    --text: #36453e; --muted: #6a7a72; --grid: #dddddd; --bg: #fafaf8; --card: #ffffff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: var(--text); background: var(--bg); line-height: 1.55;
    padding: 2rem 1rem; max-width: 960px; margin: 0 auto;
  }
  h1 { font-size: 1.55rem; font-weight: 700; margin-bottom: 0.3rem; text-wrap: balance; }
  .subtitle { color: var(--muted); font-size: 0.95rem; margin-bottom: 1rem; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 2.2rem 0 0.8rem; padding-bottom: 0.3rem; border-bottom: 2px solid var(--teal); }
  h3 { font-size: 0.98rem; font-weight: 600; margin: 1.4rem 0 0.5rem; }
  p, li { font-size: 0.92rem; margin-bottom: 0.6rem; }
  ul { padding-left: 1.3rem; margin-bottom: 1rem; }
  a { color: var(--burgundy); }
  .proto-banner {
    background: var(--mint); color: var(--text); font-size: 0.85rem; font-weight: 600;
    padding: 0.5rem 0.9rem; border-radius: 6px; margin: 0.8rem 0 1.4rem; display: inline-block;
  }
  .key-message {
    background: var(--mint); border-left: 4px solid var(--teal);
    padding: 1rem 1.2rem; border-radius: 0 6px 6px 0; margin: 1.2rem 0; font-size: 0.95rem;
  }
  .key-message strong { display: block; margin-bottom: 0.3rem; }
  table.data { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin: 0.8rem 0 0.4rem; font-variant-numeric: tabular-nums; }
  table.data th, table.data td { border: 1px solid var(--grid); padding: 0.4rem 0.55rem; text-align: right; }
  table.data th { background: var(--sage); font-weight: 600; text-align: center; }
  table.data td.txt, table.data th.txt { text-align: left; }
  table.data td.ratio { font-weight: 700; }
  .tablewrap { overflow-x: auto; }
  .tablenote { color: var(--muted); font-size: 0.8rem; margin-bottom: 1.2rem; }
  .plant { color: #5c7050; }
  .meat { color: var(--burgundy); }
  .legend { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.6rem; }
  .legend span.swatch { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; vertical-align: -0.05rem; margin: 0 0.25rem 0 0.7rem; }
  .chart { margin: 1rem 0 0.4rem; }
  .chart .grp { font-size: 0.83rem; font-weight: 600; margin: 0.9rem 0 0.25rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .bar-row { display: grid; grid-template-columns: 7.5rem 1fr 3.6rem; gap: 0.5rem; align-items: center; margin-bottom: 0.3rem; font-size: 0.85rem; }
  .bar-track { position: relative; background: #efefec; border-radius: 3px; height: 1.05rem; }
  .bar-track .parity { position: absolute; left: 33.33%; top: -0.15rem; bottom: -0.15rem; width: 2px; background: var(--text); opacity: 0.55; }
  .stem { position: absolute; top: 50%; height: 2px; margin-top: -1px; }
  .stem.dear { background: var(--pink); }
  .stem.cheap { background: var(--sage); }
  .stem.trend { background: #c4ccc6; }
  .dot { position: absolute; top: 50%; width: 0.72rem; height: 0.72rem; border-radius: 50%; transform: translate(-50%, -50%); border: 1.5px solid rgba(54, 69, 62, 0.35); }
  .dot.dear { background: var(--pink); }
  .dot.cheap { background: var(--sage); }
  .dot.past { background: #ffffff; border: 2px solid #9aa8a0; }
  .axis-row { display: grid; grid-template-columns: 7.5rem 1fr 3.6rem; gap: 0.5rem; font-size: 0.75rem; color: var(--muted); margin-top: 0.15rem; }
  .axis { position: relative; height: 1rem; }
  .axis span { position: absolute; transform: translateX(-50%); }
  .bar-val { font-variant-numeric: tabular-nums; font-weight: 600; }
  .chart.wide .bar-row, .chart.wide .axis-row { grid-template-columns: minmax(8.5rem, 16rem) 1fr 6.6rem; }
  @media (max-width: 560px) { .chart.wide .bar-row, .chart.wide .axis-row { grid-template-columns: 7.5rem 1fr 5rem; font-size: 0.78rem; } }
  table.heat td { text-align: right; font-variant-numeric: tabular-nums; }
  .disclosure { color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--grid); margin-top: 2.2rem; padding-top: 0.8rem; }
  .checklist li { font-size: 0.85rem; }
  .fig { margin: 1rem 0 0.3rem; }
  .fig img { max-width: 100%; height: auto; background: #ffffff; border: 1px solid var(--grid); border-radius: 4px; padding: 0.4rem; }
  .fignote { color: var(--muted); font-size: 0.83rem; margin: 0.5rem 0 0.4rem; }
  .refs li { font-size: 0.85rem; margin-bottom: 0.5rem; }
  .tabs { margin: 0.9rem 0 1.1rem; border-bottom: 2px solid var(--teal); }
  .tab { display: inline-block; padding: 0.35rem 0.9rem; font-size: 0.9rem; font-weight: 600; color: var(--muted); text-decoration: none; border: 1px solid var(--grid); border-bottom: none; border-radius: 6px 6px 0 0; background: #f1f1ee; margin-right: 0.3rem; }
  .tab.active { color: var(--text); background: var(--card); border-color: var(--teal); }
`;

// ---- page ----
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK plant-based vs meat price check</title>
<meta name="description" content="Price comparison of plant-based products and their meat equivalents at the big UK supermarket chains, per 100g, updated daily. Follows the Which? (2022) basket.">
<style>${STYLE}</style>
</head>
<body>

<h1>Plant-based products vs their meat equivalents: UK supermarket price check</h1>
<div class="subtitle">Own-brand and branded pairs at the big UK chains, per 100g/100ml, following and extending the basket in Which? (2022). Shelf prices only: loyalty-card prices (Nectar, Clubcard) and multibuy offers are recorded but excluded from all figures, matching the Which? approach.</div>
${tabs("retail")}
<div class="proto-banner">Updated daily. Series since ${fmtD(firstDate)}; latest prices ${fmtD(lastDate)} (${nDates} day${nDates === 1 ? "" : "s"} of data). Ratios are averages of daily prices over the series.</div>

<div class="key-message">
  <strong>Latest picture (${fmtD(lastDate)})</strong>
  Price ratios, plant-based / meat equivalent: ${keyMessage()}
</div>

<h2>Price ratio overview: plant-based / meat, per 100g</h2>
<div class="legend">Dot = ratio of plant-based price per 100g to the meat equivalent, averaged over the series.
  <span class="swatch" style="background: var(--pink);"></span>plant-based costs more
  <span class="swatch" style="background: var(--sage);"></span>plant-based cheaper or equal
</div>
<div class="chart">
${mainChart()}
</div>
<p class="tablenote">The Asda burger figure compares a vegetable burger (not a meat-imitation product) against quarter pounders; see the burgers table note.</p>

${OWN_CATS.map(ownTable).join("\n\n")}

<h2>Branded pairs across chains</h2>
${brandedTable("richmond-saus", "Richmond sausages: 8 Meat Free Vegan (304g) vs 8 Thick Pork (410g)",
  "Which? (2022) found Richmond meat-free at 0.72 to 0.84 and pork at 0.50 to 0.55 per 100g.")}
${brandedTable("magnum-ice", "Magnum: Collection Vegan Classic (3 x 90ml) vs Classic Chocolate (3 x 100ml)",
  "Loyalty-card prices (Nectar, Clubcard) are excluded from all figures throughout; unusually low chain prices may be unflagged promotions.")}
${brandedTable("ginsters-pasty", "Ginsters: Vegan Quorn Pasty (180g) vs Original Cornish Pasty (227g)",
  "The same-brand pair Which? (2022) compared (then 0.88-1.11 vegan vs 0.64-0.86 original per 100g across chains).")}
${brandedTable("hellmanns-mayo", "Hellmann's: Plant Based Mayo (750ml) vs Real Mayonnaise (580ml)",
  "Pack sizes differ (750ml vs 580ml), so the ratio partly reflects pack size.")}
${brandedTable("heinz-mayo", "Heinz: Seriously Good Vegan Mayo (775g) vs Seriously Good Mayonnaise (775g)",
  "Same size both sides. A Waitrose listing for the standard product is excluded as a suspected stale or promotional record.")}

<h2>Trend since Which? (2022)</h2>
<p>How the plant/meat price ratio moved between the Which? study (average of daily prices, Aug to Oct 2022) and the current series average. The trend is shown in ratios; nominal per-100g prices are in the table below. Pairs marked * are category-level comparisons where one or both 2022 products have been discontinued or replaced, so those moves partly reflect product turnover, not price changes.</p>
<div class="legend"><span class="swatch" style="background: #ffffff; border: 2px solid #9aa8a0;"></span>2022 ratio (Which?)
  <span class="swatch" style="background: var(--pink);"></span>current ratio, plant costs more
  <span class="swatch" style="background: var(--sage);"></span>current ratio, plant cheaper or equal
</div>
<div class="chart">
${trendChart()}
</div>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Pair (per 100g, GBP)</th><th>Plant 2022</th><th>Plant now</th><th>Meat 2022</th><th>Meat now</th><th>Ratio 2022</th><th>Ratio now</th></tr></thead>
  <tbody>
${trendTable()}
  </tbody>
</table>
</div>
<p class="tablenote">2022 figures are Which? three-month averages (Co-op: point prices supplied 5 Dec 2022); "now" figures are the latest scrape with ratios averaged over the series. Product-change flags (*): Waitrose sausages compared Mushroom &amp; Leek vs British pork in 2022 but chorizo vs no-chorizo now; Tesco's 2022 Meat &amp; Veg burger comparator and Asda's 2022 meat-imitation burger are no longer listed (the current Asda plant product is a vegetable burger); Waitrose's current beef comparator is a premium-tier product; Hellmann's pack sizes changed (430ml squeezy both sides in 2022, 750ml vegan vs 580ml real now). The 2022 Co-op comparator was a gluten-free pork sausage, and Co-op had just price-matched its vegan range.</p>

<h2>Method and caveats</h2>
<ul class="checklist">
  <li><strong>Product basket:</strong> follows the own-brand and branded pairs in <a href="https://www.which.co.uk/news/article/plant-based-alternatives-can-cost-twice-as-much-as-meat-which-finds-a4AzY8r4gTpO">Which? (Dec 2022), "Plant-based alternatives can cost twice as much as meat"</a>, re-matched to 2026 assortments and extended with mince, meatballs and additional pairs. Each pair is a plant-based product and its nearest meat/dairy/egg equivalent in the same range tier. The register (with pack sizes and matching decisions) is <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/pairs.json">pairs.json</a>.</li>
  <li><strong>Prices:</strong> scraped daily from <a href="https://www.trolley.co.uk">trolley.co.uk</a> product pages (a price aggregator; secondary source) because Tesco, Asda, Ocado and Co-op block automated access to their own sites. Sainsbury's rows are fetched from Sainsbury's own product API (primary source) where the product surfaces there; each data row records its source. The scrape respects the aggregator's robots.txt (product pages are allowed; its search is not used).</li>
  <li><strong>Unit prices:</strong> pounds per 100g/100ml computed from the pack price and the register's hand-verified pack weight. The aggregator's own multipack unit prices are wrong (it multiplies pack count by total weight) and are not used, except for two single-container products whose weight the aggregator carries reliably.</li>
  <li><strong>Shelf prices only:</strong> loyalty-card prices (Nectar, Clubcard) and multibuy offers are recorded but excluded from all figures, matching the Which? approach.</li>
  <li><strong>Averaging:</strong> Which? averaged three months of daily prices; this site shows the latest day's prices and averages ratios over the accumulating daily series (${nDates} day${nDates === 1 ? "" : "s"} so far, since ${fmtD(firstDate)}).</li>
  <li><strong>Coverage gaps:</strong> M&amp;S (not on the aggregator; its coleslaw pack weights cannot be verified); Morrisons sausages/burgers/mince/meatballs/coleslaw, Asda sausages, and Co-op mince/meatballs (no comparable own-brand pair found); the 2022 Tesco and Waitrose ready-meal pairs are discontinued.</li>
</ul>

<h2>Data</h2>
<ul>
  <li>Full daily history: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history.json">history.json</a> / <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history.csv">history.csv</a> (one row per product, store and date, with provenance).</li>
  <li>Pair register with matching decisions: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/pairs.json">pairs.json</a>.</li>
  <li>Wholesale (foodservice) comparison: <a href="wholesale.html">separate page</a>.</li>
  <li>Code: <a href="https://github.com/akanepajs/uk-food">github.com/akanepajs/uk-food</a>.</li>
</ul>

<div class="disclosure">
  Site prepared with Claude Code (data collection, verification and page build). Prices are shelf prices and may have changed. Sources: trolley.co.uk (aggregator), Sainsbury's product API, Which? (2022).
  Page generated ${fmtD(lastDate)}.
  © 2026 Artūrs (Art) Kaņepājs. Contact: hello@kanepajs.eu
</div>

</body>
</html>
`;

// ---- wholesale page ----
const wbody = wLatest.length ? wholesaleSection()
  : `<p>No wholesale data yet: the first daily scrape has not landed. The retail comparison is on the <a href="retail.html">retail page</a>.</p>`;
const whtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK plant-based vs meat wholesale price check</title>
<meta name="description" content="Wholesale (foodservice) price comparison of plant-based products and their meat equivalents at UK distributors JJ Foodservice, Brakes and Bidfood, including same-brand pairs, per 100g, updated daily.">
<style>${STYLE}</style>
</head>
<body>

<h1>Plant-based products vs their meat equivalents: UK wholesale (foodservice) price check</h1>
<div class="subtitle">Catering pairs at UK foodservice distributors JJ Foodservice, Brakes and Bidfood, including same-brand pairs, per 100g/100ml</div>
${tabs("wholesale")}
${wLatest.length ? `<div class="proto-banner">Updated daily. Series since ${fmtD(wdates[0])}; latest prices ${fmtD(wLast)} (${wnDates} day${wnDates === 1 ? "" : "s"} of data)${wnDates >= 2 ? ". Ratios are averages of daily prices over the series" : ""}.</div>` : ""}

${wLatest.length ? `<div class="key-message">
  <strong>Latest picture (${fmtD(wLast)})</strong>
  Price ratios, plant-based / meat equivalent: ${wKeyMessage()}
</div>` : ""}

${wbody}

<h2>Data</h2>
<ul>
  <li>Wholesale daily history: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history_wholesale.json">history_wholesale.json</a> / <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history_wholesale.csv">history_wholesale.csv</a> (one row per product, distributor and date, with price basis, branch range, stock and promo fields).</li>
  <li>Pair register with matching decisions: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/pairs_wholesale.json">pairs_wholesale.json</a>; Bidfood snapshot register: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/pairs_bidfood_static.json">pairs_bidfood_static.json</a>.</li>
  <li>Retail comparison: <a href="retail.html">retail page</a>; code: <a href="https://github.com/akanepajs/uk-food">github.com/akanepajs/uk-food</a>.</li>
</ul>

<div class="disclosure">
  Site prepared with Claude Code (data collection, verification and page build). Prices are list/shelf prices and may have changed. Sources: JJ Foodservice and Brakes product pages and a Bidfood Direct trade-account snapshot (wholesale); AHDB (context links).
  Page generated ${fmtD(wLast || lastDate)}.
  © 2026 Artūrs (Art) Kaņepājs. Contact: hello@kanepajs.eu
</div>

</body>
</html>
`;

// ---- research page ----
// Charts are site-style HTML lollipops (same idiom as the Retail/Wholesale tabs), rendered
// from research_data.json only (see the RD load above for the verification chain).
function linPos(v, min, max) { return (v - min) / (max - min) * 100; }
// One lollipop row on a linear scale: dot at v, stem from the reference line at ref.
function rLolli(label, v, valText, min, max, ref, cls) {
  // round endpoints BEFORE deriving the stem, so stem end lands exactly on the dot/reference
  const p = +linPos(v, min, max).toFixed(1), pr = +linPos(ref, min, max).toFixed(1);
  const left = Math.min(p, pr), width = +Math.abs(p - pr).toFixed(1);
  const stem = (width > 0.3 && cls !== "past") ? `<div class="stem ${cls}" style="left: ${left.toFixed(1)}%; width: ${width.toFixed(1)}%;"></div>` : "";
  return `  <div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div class="parity" style="left: ${pr.toFixed(1)}%;"></div>${stem}<div class="dot ${cls}" style="left: ${p.toFixed(1)}%;"></div></div><span class="bar-val">${valText}</span></div>`;
}
function rAxis(ticks, min, max, fmt) {
  const spans = ticks.map(t => {
    const p = linPos(t, min, max);
    const tr = p < 3 ? " transform: none;" : (p > 97 ? " transform: translateX(-100%);" : "");
    return `<span style="left: ${p.toFixed(1)}%;${tr}">${fmt(t)}</span>`;
  }).join("");
  return `  <div class="axis-row"><span></span><div class="axis">${spans}</div><span></span></div>`;
}
function kantarChart() {
  const k = RD.kantar, min = 0, max = 3, ref = k.mfp_gbp;
  const rows = [rLolli("Meal with meat, fish or poultry (MFP)", ref, `&pound;${ref.toFixed(2)}`, min, max, ref, "past")];
  for (const r of k.rows) rows.push(rLolli(r.label, r.gbp, `&pound;${r.gbp.toFixed(2)} (-${r.save_pct}%)`, min, max, ref, "cheap"));
  rows.push(rAxis([0, 1, 2, 3], min, max, t => `&pound;${t}`));
  return rows.join("\n");
}
function springChart() {
  const s = RD.springmann, min = -40, max = 10;
  const rows = s.diets.map(d => rLolli(d.label, d.pct.market, `${d.pct.market.toFixed(1)}%`, min, max, 0, "cheap"));
  rows.push(rAxis([-40, -30, -20, -10, 0, 10], min, max, t => t > 0 ? `+${t}%` : `${t}%`));
  return rows.join("\n");
}
function springTable() {
  const s = RD.springmann;
  const head = s.cost_items.map(it => `<th>${esc(s.item_labels[it])}</th>`).join("");
  const body = s.diets.map(d => {
    const cells = s.cost_items.map(it => {
      const v = d.pct[it];
      const a = Math.min(0.85, Math.abs(v) / 50);  // sage shading scaled to the deepest saving
      return `<td style="background: rgba(192, 208, 169, ${a.toFixed(2)});">${v.toFixed(1)}%</td>`;
    }).join("");
    return `    <tr><td class="txt">${esc(d.label)}</td>${cells}</tr>`;
  }).join("\n");
  return `<div class="tablewrap">
<table class="data heat">
  <thead><tr><th class="txt">Dietary pattern</th>${head}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>`;
}
function otherChart() {
  const min = -25, max = 5;
  const rows = RD.other_studies.map(o => rLolli(o.label, o.pct, o.val, min, max, 0, "cheap"));
  rows.push(rAxis([-25, -20, -15, -10, -5, 0, 5], min, max, t => t > 0 ? `+${t}%` : `${t}%`));
  return rows.join("\n");
}
function itemsChart() {
  const min = -75, max = 75;
  const rows = RD.items.map(o => rLolli(o.label, o.pct, `${o.pct > 0 ? "+" : ""}${o.pct}%`, min, max, 0, o.pct > 0.5 ? "dear" : "cheap"));
  rows.push(rAxis([-75, -50, -25, 0, 25, 50, 75], min, max, t => t > 0 ? `+${t}%` : `${t}%`));
  return rows.join("\n");
}
// Absolute USD per 50g protein (Drewnowski & Conrad 2024, Table 3); the reference line is
// pulses, so the chart reads as "which animal proteins beat pulses on a per-protein basis".
// Unlike the other charts this one is not a signed % vs one animal product, hence its own renderer.
function drewChart() {
  const d = RD.drewnowski, min = 0, max = 5;
  const ref = d.protein50g_usd.find(r => r.label === "Pulses").usd;
  const rows = d.protein50g_usd.map(r => r.label === "Pulses"
    ? rLolli("Pulses (plant reference)", r.usd, `$${r.usd.toFixed(2)}`, min, max, ref, "past")
    : rLolli(r.label, r.usd, `$${r.usd.toFixed(2)}`, min, max, ref, r.usd < ref ? "dear" : "cheap"));
  rows.push(rAxis([0, 1, 2, 3, 4, 5], min, max, t => `$${t}`));
  return rows.join("\n");
}
// UK replication of the same per-protein chart (GBP; published multi-retailer averages,
// ONS Jan 2025 + Defra Family Food FYE 2024; CoFID 2021 protein). Same scale and colour
// semantics as drewChart so the two sections read side by side.
function drewUkChart() {
  const d = RD.drewnowski_uk, min = 0, max = 5;
  const ref = d.protein50g_gbp.find(r => r.label === "Pulses").gbp;
  const rows = d.protein50g_gbp.map(r => r.label === "Pulses"
    ? rLolli("Pulses (plant reference)", r.gbp, `&pound;${r.gbp.toFixed(2)}`, min, max, ref, "past")
    : rLolli(r.label, r.gbp, `&pound;${r.gbp.toFixed(2)}`, min, max, ref, r.gbp < ref ? "dear" : "cheap"));
  rows.push(rAxis([0, 1, 2, 3, 4, 5], min, max, t => `&pound;${t}`));
  return rows.join("\n");
}

const rhtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK plant-based vs meat costs: research findings</title>
<meta name="description" content="UK evidence on plant-based vs animal-product food and catering costs: GB per-meal panel data, modelled UK whole-diet costs (Springmann et al. 2021), catering case studies, US and UK cost-per-protein checks and item-level retail price gaps.">
<style>${STYLE}</style>
</head>
<body>

<h1>Plant-based vs animal-product food costs: what the research says</h1>
<div class="subtitle">Findings from a review of the published cost-comparison literature (compiled June to July 2026)</div>
${tabs("research")}

<p>This page shows findings from published studies and reports. Sources are cited below each chart;
full references are at the bottom of the page.</p>

<h2>Average main-meal cost (GB household panel)</h2>
<div class="legend">Dot = average cost per main meal.
  <span class="swatch" style="background: #ffffff; border: 2px solid #9aa8a0;"></span>reference meal
  <span class="swatch" style="background: var(--sage);"></span>cheaper than the reference
</div>
<div class="chart wide">
${kantarChart()}
</div>
<p class="fignote">All four values come from the same GB household panel (Kantar Usage, total main-meal
occasions, 52 weeks ending 23 February 2025), as reported by AHDB (2025). A meal containing meat, fish
or poultry (MFP) averages &pound;2.86; substituting the meat with a plant-based alternative leaves the
cost almost unchanged at &pound;2.82 (a 4p saving, about 1.4%; the chart's percentage follows the
article's own rounded label, so it shows 1%); a meal without meat averages &pound;1.57,
a 45% saving; and the average across all main meals is &pound;2.31, 19% below the MFP meal. These are
household retail purchases, not
catering costs, and are not income-controlled. Source: AHDB (2025, reporting Kantar).</p>

<h2>Modelled whole-diet costs for the UK</h2>
<p>Springmann et al. (2021) modelled the cost of energy- and nutrient-matched dietary patterns in 150
countries at 2017 international prices. The chart shows the UK (GBR) cells from the study's
supplementary cost dataset: the change in daily diet cost at market prices, relative to the modelled
current UK diet.</p>
<div class="legend">Dot = modelled change in daily diet cost at market prices vs the current UK diet.
  <span class="swatch" style="background: var(--sage);"></span>cheaper than the current diet
</div>
<div class="chart wide">
${springChart()}
</div>
<p class="fignote">At market prices the flexitarian pattern is 17.0% cheaper than the current UK diet
(95% CI 13.3 to 18.5); vegetarian 26.5% (high-grain variant 30.9%), vegan
20.8% (high-grain 33.3%) and pescatarian 1.9% (high-grain 5.4%) cheaper (statistically
insignificant). These are modelled retail prices, not
catering prices. Source: Springmann et al. (2021), supplementary data.</p>

<h3>The same UK results across all six cost bases</h3>
${springTable()}
<p class="fignote">Change in daily diet cost vs the current UK diet on each of the study's cost bases;
darker green = larger saving. "Waste halved" reprices the diet with food waste cut by half; "with
health costs" and "with climate costs" add the diet's modelled diet-related health costs or
climate-change costs to market prices; "full cost" adds both. All 42 UK cells are cheaper than the
current diet. For scale, the modelled current UK diet costs USD 7.69 per person per day at market
prices (2017 international prices), rising to USD 9.13 when health and climate costs are included. The
dataset also includes the average high-income-country diet as a comparator scenario (not a plant-based
pattern, so not shown): at market prices it would be 6.2% cheaper than the current UK diet. Source:
Springmann et al. (2021), supplementary data.</p>

<h2>Catering and basket studies</h2>
<div class="legend">Dot = reported cost change for the plant-forward option vs the conventional one
(0%, vertical line).
  <span class="swatch" style="background: var(--sage);"></span>plant-forward cheaper
</div>
<div class="chart wide">
${otherChart()}
</div>
<p class="fignote">The France value (Un Plus Bio, 2020) is the ingredient-cost gap between French
canteens serving a daily vegetarian option (EUR 1.96 per meal) and those serving none (EUR 2.30),
about 15%; France 2019 data. The CAWF (2024) basket is a hypothetical UK comparison priced partly on
US dietary data. Source: CAWF (2024); Un Plus Bio (2020).</p>
<p class="fignote"><strong>Case study: NYC Health + Hospitals (US).</strong> The largest institutional
implementation measured to date points the same way in catering money: recipe-level plant-based
reformulation across NYC's 11 public hospitals saved a self-reported USD 0.59 per meal in 2023 (about
&pound;0.47 in 2025 money). The case differs from the GB panel in jurisdiction, setting and
method, so the contrast illustrates the mechanism rather than a controlled estimate. Source: NYC Health +
Hospitals (2024).</p>

<h2>Cost per unit of protein (US retail, 2017 to 2018)</h2>
<div class="key-message">
  <strong>A different measuring basis</strong>
  Every estimate above compares diets or meals at similar calorie intake and overall nutritional
  adequacy; none of them holds protein constant. Springmann et al. (2021), for example, replace meat
  with plant foods "on a kcal basis", with each pattern built around a minimum quantity of
  plant-based protein sources rather than a gram-for-gram protein match. Priced per unit of protein
  instead of per meal or per calorie, the plant-versus-animal cost gap narrows and can reverse, as
  the US figures below show. They are US retail prices, not UK, so read this section as a point
  about measurement, not as a UK cost estimate. The next section repeats the calculation with
  UK prices.
</div>
<p>Drewnowski and Conrad (2024) price US protein sources both ways from the same national retail
price data. The chart shows the cost of 50g of protein (100% of the US daily value) from each
source, with pulses (peas, beans, lentils and chickpeas) as the plant-based reference.</p>
<div class="legend">Dot = US retail price of 50g of protein from each source.
  <span class="swatch" style="background: #ffffff; border: 2px solid #9aa8a0;"></span>pulses (reference)
  <span class="swatch" style="background: var(--pink);"></span>animal protein cheaper
  <span class="swatch" style="background: var(--sage);"></span>animal protein costs more
</div>
<div class="chart wide">
${drewChart()}
</div>
<p class="fignote"><strong>Per 100g of food</strong> the same data make pulses the cheapest protein source of all
(USD 0.36 per 100g, below even eggs at USD 0.53, the cheapest animal source; chicken 0.91, pork
1.01, beef 1.91, fish 2.00). <strong>Per 50g of protein</strong> the ranking reverses at the top: pulses cost more
than pork, chicken and eggs, and less than only beef and fish, because pulses provide less than 10g
of protein per 100g of food against more than 20g for meat and fish. Prices are US national mean
retail prices (USDA Purchase to Plate Price Tool, FNDDS 2017 to 2018 food data); they predate
recent inflation, are not income-controlled, and protein is not adjusted for digestibility. Source:
Drewnowski &amp; Conrad (2024).</p>

<h2>Cost per unit of protein (UK retail averages, 2024 to 2025)</h2>
<p>The same calculation can be run for the UK from published average prices that cover many
retailers. Prices are ONS averages for January 2025, the last month with detailed food-item
average prices; Defra Family Food unit values for the financial year 2023-24 supply the fresh
pork and dried pulses prices. Protein content comes from the official UK food composition tables
(CoFID 2021). Each category mean covers one to three representative items.</p>
<div class="legend">Dot = UK average retail price of 50g of protein from each source.
  <span class="swatch" style="background: #ffffff; border: 2px solid #9aa8a0;"></span>pulses (reference)
  <span class="swatch" style="background: var(--pink);"></span>animal protein cheaper
  <span class="swatch" style="background: var(--sage);"></span>animal protein costs more
</div>
<div class="chart wide">
${drewUkChart()}
</div>
<p class="fignote"><strong>Per 100g of food</strong> pulses are again the cheapest source (&pound;0.27
per 100g, below eggs at &pound;0.56, the cheapest animal source; pork 0.69, chicken 0.80, beef 1.34,
fish 1.67; boneless items only). <strong>Per 50g of protein</strong> the ranking shifts less in the
UK than in the US data: chicken (&pound;1.61) is at parity with pulses (&pound;1.64) and pork costs
only slightly more (&pound;1.69), while eggs (&pound;2.24), beef (&pound;3.29) and fish (&pound;4.21)
all cost more than pulses; lamb (not shown) is the most expensive source at &pound;7.14. Within UK
pulses, dried pulses alone provide 50g of protein for about &pound;0.61, cheaper than any category
shown. Relative to pulses, every animal category costs more in these UK figures than in the US
figures above; differences in price year (US 2017 to 2018), item mix and production standards can
all contribute. UK prices are as-sold (raw meat, canned or dried pulses; bone-in items are priced
per bone-in weight, with protein measured on the same basis), while the US prices are as-consumed.
Per-protein costs are robust to that difference, but per-100g levels are not directly comparable
across the two charts, and protein is again not adjusted for digestibility. Sources: ONS (2025);
Defra (2025); Public Health England (2021).</p>

<h2>Item-level price gaps (UK retail, 2024 to 2026)</h2>
<div class="legend">Dot = plant-based price vs the animal product it substitutes (0%, vertical line).
  <span class="swatch" style="background: var(--sage);"></span>plant-based cheaper
  <span class="swatch" style="background: var(--pink);"></span>plant-based costs more
</div>
<div class="chart wide">
${itemsChart()}
</div>
<p class="fignote">Mince, meatball and burger figures are from a Tesco price snapshot, January to March
2026, one retailer and one quarter, during a period of rising meat prices in which beef rose fastest
(supermarket beef prices up more than 10% year on year in the week ending 25 April 2026, lean beef
mince up 23%) (GFI Europe, 2026); the mince figure compares against beef mince specifically. Milk and cream figures are from retail
data (GFI Europe, 2025, based on Circana retail sales and NIQ Homescan panel data): the overall
per-litre plant-milk premium (around two-thirds, shown as +67%) is mostly a
branding-mix artefact, since branded-versus-branded the gap is 16% and branded plant cream is near parity
(1.6% more expensive). Because percentages are relative to the animal product's price, +67% means
plant-based milk costs about 1.67 times as much per litre as dairy milk; put the other way round, dairy
is about 40% cheaper than plant-based milk. The Retail and Wholesale tabs above track this item-level
picture with daily UK prices. Source: GFI Europe (2026, mince and meatballs); GFI Europe (2025, milk
and cream).</p>

<h2>References</h2>
<ul class="refs">
  <li>AHDB (Adamson, V.) (2025). <a href="https://ahdb.org.uk/news/consumer-insight-flexitarian-trends-shifting-diets-and-changing-preferences">Flexitarian trends: shifting diets and changing preferences</a>. AHDB Consumer Insight, 22 May 2025. Data: Kantar Usage panel, total main meal occasions, 52 weeks ending 23 February 2025 (GB).</li>
  <li>Conservative Animal Welfare Foundation (2024, 27 January). <a href="https://www.conservativeanimalwelfarefoundation.org/wp-content/uploads/2024/01/2-Billion-NHS-Windfall-CAWF.pdf">The &pound;2 billion NHS windfall: Why meat reduction matters</a>.</li>
  <li>Defra (2025). <a href="https://www.gov.uk/government/statistical-data-sets/family-food-datasets">Family Food datasets: UK household purchases and expenditure, financial year ending 2024</a> [data]. Unit values derived as expenditure divided by quantity purchased.</li>
  <li>Drewnowski, A., &amp; Conrad, Z. (2024). <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11377338/">Pulse crops: nutrient density, affordability, and environmental impact</a>. Frontiers in Nutrition, 11, 1438369. doi:10.3389/fnut.2024.1438369. Prices from USDA Purchase to Plate Price Tool, FNDDS 2017-18.</li>
  <li>Good Food Institute Europe (2025). <a href="https://gfieurope.org/wp-content/uploads/2025/06/UK-plant-based-food-retail-market-insights-2022-2024.pdf">UK plant-based food retail market insights: 2022 to January 2025</a>. Based on Circana retail sales data and NIQ Homescan household panel data.</li>
  <li>Good Food Institute Europe (2026). <a href="https://gfieurope.org/blog/plant-based-mince-and-meatballs-33-cheaper-than-meat-versions-at-uks-largest-retailer-amid-rising-meat-prices/">Plant-based mince and meatballs 33% cheaper than meat versions at UK's largest retailer amid rising meat prices</a>. 29 April 2026.</li>
  <li>NYC Health + Hospitals (2024). <a href="https://www.nychealthandhospitals.org/pressrelease/nyc-health-hospitals-celebrates-1-2-million-plant-based-meals-served/">NYC Health + Hospitals celebrates 1.2 million plant-based meals served</a>. Press release, 14 March 2024.</li>
  <li>ONS (2025). <a href="https://www.ons.gov.uk/economy/inflationandpriceindices/adhocs/2724shoppingpricescomparisontooldatadownloadbeforethe2025update">Shopping prices comparison tool: data download before the 2025 update</a> [data]. Office for National Statistics. UK average prices from the CPI monthly price collection; detailed food-item series end January 2025.</li>
  <li>Public Health England (2021). <a href="https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid">McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID)</a> [data].</li>
  <li>Springmann, M., Clark, M. A., Rayner, M., Scarborough, P., &amp; Webb, P. (2021). <a href="https://www.thelancet.com/journals/lanplh/article/PIIS2542-5196(21)00251-5/fulltext">The global and regional costs of healthy and sustainable dietary patterns: a modelling study</a>. The Lancet Planetary Health, 5(11), e797-e807. doi:10.1016/S2542-5196(21)00251-5</li>
  <li>Un Plus Bio (2020). <a href="https://www.unplusbio.org/wp-content/uploads/2020/11/R%C3%A9sultats-2020-OBSERVATOIRE.pdf">Observatoire national de la restauration collective bio et durable: Resultats de l'enquete 2020</a> [survey report].</li>
</ul>

<div class="disclosure">
  Page prepared with Claude Code (literature review, data verification and page build).
  Page generated ${fmtD(lastDate)}.
  © 2026 Artūrs (Art) Kaņepājs. Contact: hello@kanepajs.eu
</div>

</body>
</html>
`;

// Redirect stub: the research content moved from research.html to the site root.
const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./">
<link rel="canonical" href="https://uk-food.kanepajs.eu/">
<title>UK plant-based vs meat costs: research figures</title>
</head>
<body>
<p>This page moved to the <a href="./">site home page</a>.</p>
</body>
</html>
`;

// Hard rule: no em dashes in outward-facing files.
for (const [name, doc] of [["retail.html", html], ["wholesale.html", whtml], ["index.html", rhtml], ["research.html", redirectHtml]]) {
  if (doc.includes("—")) {
    console.error(`FATAL: em dash found in generated ${name}.`);
    process.exit(1);
  }
}
await writeFile(new URL("../retail.html", import.meta.url), html);
await writeFile(new URL("../wholesale.html", import.meta.url), whtml);
await writeFile(new URL("../index.html", import.meta.url), rhtml);
await writeFile(new URL("../research.html", import.meta.url), redirectHtml);
console.log(`retail.html generated: ${dates.length} date(s), latest ${lastDate}, ${latest.length} latest rows.`);
console.log(`wholesale.html generated: ${wnDates} date(s), latest ${wLast || "-"}, ${wLatest.length} latest rows.`);
console.log(`index.html (research landing) + research.html redirect generated.`);
