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
  const body = rows.map(r => {
    const unit = r.p.unit === "ml" ? "£/100ml" : "£/100g";
    return `    <tr><td class="txt">${esc(r.pair.chain)}</td><td class="txt plant">${esc(r.pair.plant.label)}${r.pair.plant.amount ? ", " + r.pair.plant.amount + r.p.unit : ""}</td><td>${f2(r.p.price_gbp)}</td><td>${f2(r.p.per100)}</td><td class="txt meat">${esc(r.pair.meat.label)}${r.pair.meat.amount ? ", " + r.pair.meat.amount + r.m.unit : ""}</td><td>${f2(r.m.price_gbp)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`;
  }).join("\n");
  return `<h2>${esc(heading)}</h2>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Chain</th><th class="txt">Plant-based product</th><th>£</th><th>£/100</th><th class="txt">${esc(meatHead)}</th><th>£</th><th>£/100</th><th>Ratio</th>${avgCol ? `<th>Avg ratio (${nDates}d)</th>` : ""}</tr></thead>
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
  const body = rows.map(r =>
    `    <tr><td class="txt">${esc(r.store)}</td><td>${f2(r.p.price_gbp)}</td><td>${f2(r.p.per100)}</td><td>${f2(r.m.price_gbp)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`).join("\n");
  return `<h3>${esc(title)}</h3>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Chain</th><th>Plant £</th><th>Plant £/100</th><th>Standard £</th><th>Standard £/100</th><th>Ratio</th>${avgCol ? `<th>Avg (${nDates}d)</th>` : ""}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>
<p class="tablenote">${note}</p>`;
}

// ---- key message (computed) ----
function keyMessage() {
  const seg = [];
  const saus = own["sausages"];
  if (saus.length) {
    const over = saus.filter(r => r.ratio >= 1.5);
    const list = saus.map(r => `${r.pair.chain} ${fr(r.ratio)}`).join(", ");
    seg.push(`Own-brand plant-based sausages cost more per 100g than pork sausages at every chain with a comparable pair (${list})${over.length >= saus.length - 1 ? ", roughly double at most of them" : ""}.`);
  }
  const burg = own["burgers"];
  if (burg.length) {
    const v = burg.map(r => r.ratio);
    seg.push(`Burgers run ${fr(Math.min(...v))} to ${fr(Math.max(...v))}.`);
  }
  const mince = own["mince"], balls = own["meatballs"];
  if (mince.length && balls.length) {
    const mv = mince.map(r => r.ratio), bv = balls.map(r => r.ratio);
    seg.push(`Mince and meatballs mostly flip the other way: plant mince is cheaper at all ${mince.length} chains with a pair (${fr(Math.min(...mv))} to ${fr(Math.max(...mv))} vs standard 20% fat beef mince), and plant meatballs run ${fr(Math.min(...bv))} to ${fr(Math.max(...bv))}.`);
  }
  const mayo = own["mayonnaise"];
  if (mayo.length) {
    seg.push(`Own-brand vegan mayonnaise carries the largest premium in the basket (${fr(mayo[0].ratio)} at ${mayo[0].pair.chain}), while Heinz sells its vegan and standard mayo at the same price and size.`);
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

// Wholesale "Latest picture" summary, composed from the same rows as the chart so it
// can never contradict the data. Every claim is conditional on what the ratios show.
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
  if (mb.length) {
    seg.push(mb.every(r => (r.avg ?? r.ratio) <= 1.05)
      ? `Plant-based mince and meatballs are cheaper than or at parity with their meat equivalents in every wholesale pair (${rng(mb)}).`
      : `Plant-based mince and meatballs run ${rng(mb)}.`);
  }
  const saus = by("sausage");
  if (saus.length) {
    seg.push(saus.every(r => (r.avg ?? r.ratio) > 1)
      ? `Plant-based sausages cost more per 100g in every pair (${rng(saus)}).`
      : `Sausages run ${rng(saus)}.`);
  }
  const burg = by("burger");
  if (burg.length) seg.push(`Burgers run ${rng(burg)} (see the pair notes: the JJ pair compares coated chicken formats).`);
  const mayo = by("mayo");
  if (mayo.length) seg.push(`Same-brand vegan mayonnaise runs ${rng(mayo)}.`);
  return seg.join(" ");
}

function wholesaleSection() {
  const rows = wholesaleRows();
  if (!rows.length) return "";
  const avgCol = wnDates >= 2;
  const priceCell = r => f2(r.price_gbp) + (r.was_price ? "&nbsp;*" : "");
  const distTable = dist => {
    const drows = rows.filter(r => r.pair.distributor === dist);
    if (!drows.length) return "";
    const body = drows.map(r =>
      `    <tr><td class="txt">${esc(r.pair.category)}</td><td class="txt plant">${esc(r.pair.plant.label)}</td><td>${priceCell(r.p)}</td><td>${f2(r.p.per100)}</td><td class="txt meat">${esc(r.pair.meat.label)}</td><td>${priceCell(r.m)}</td><td>${f2(r.m.per100)}</td><td class="ratio">${fr(r.ratio)}</td>${avgCol ? `<td>${fr(r.avg)}</td>` : ""}</tr>`).join("\n");
    return `<h2>${esc(dist)}</h2>
<div class="tablewrap">
<table class="data">
  <thead><tr><th class="txt">Category</th><th class="txt">Plant-based product</th><th>&pound;</th><th>&pound;/100</th><th class="txt">Meat or standard product</th><th>&pound;</th><th>&pound;/100</th><th>Ratio</th>${avgCol ? `<th>Avg (${wnDates}d)</th>` : ""}</tr></thead>
  <tbody>
${body}
  </tbody>
</table>
</div>`;
  };
  const chart = [];
  for (const dist of ["JJ Foodservice", "Brakes"]) {
    const drows = rows.filter(r => r.pair.distributor === dist);
    if (!drows.length) continue;
    chart.push(`  <div class="grp">${esc(dist)}</div>`);
    for (const r of [...drows].sort((a, b) => b.ratio - a.ratio)) {
      chart.push(lollipop(r.pair.category, r.avg ?? r.ratio, fr(r.avg ?? r.ratio)));
    }
  }
  chart.push(axisRow);
  const cheaper = rows.filter(r => r.ratio <= 1.005).length;
  const noteRows = wreg.pairs.filter(pr => rows.some(r => r.pair.pair_id === pr.pair_id) && pr.note)
    .map(pr => `<li><strong>${esc(pr.pair_id)}</strong> (${esc(pr.distributor)}, ${esc(pr.category)}): ${esc(pr.note)}</li>`).join("\n  ");
  return `<p>Public-sector and contract caterers buy at wholesale, not retail, so this page tracks the same plant-vs-meat comparison at the two UK foodservice distributors whose product prices are publicly visible without an account: <a href="https://www.jjfoodservice.com">JJ Foodservice</a> (cash-and-carry and delivered wholesale) and <a href="https://www.brake.co.uk">Brakes</a> (contract-catering distribution). Of the other candidates probed (7 Jul 2026), Booker and Costco UK block automated access outright and Bidfood shows prices only to account holders. In the latest scrape (${fmtD(wLast)}), the plant-based product is cheaper or at parity per 100g/100ml in ${cheaper} of ${rows.length} wholesale pairs.</p>
<div class="legend">Dot = ratio of plant-based price per 100g/100ml to the meat or standard equivalent${wnDates >= 2 ? ", averaged over the series" : ""}; the stem shows the distance from parity (1.0, vertical line).
  <span class="swatch" style="background: var(--pink);"></span>plant-based costs more
  <span class="swatch" style="background: var(--sage);"></span>plant-based cheaper or equal
</div>
<div class="chart">
${chart.join("\n")}
</div>
${distTable("JJ Foodservice")}
${distTable("Brakes")}
<p class="tablenote">Prices marked * were on promotion at scrape time (the regular price is recorded in the data as was_price).</p>
<h2>Wholesale method notes</h2>
<ul class="checklist">
  <li><strong>Price basis differs from retail and between distributors.</strong> JJ Foodservice prices are ex-VAT Collection prices at the Enfield branch (its product pages publish every branch's price; the data records the min-max across branches). Brakes shows an anonymous indicative price based on an "average customer discount": a real caterer's negotiated contract price can differ, so treat Brakes figures as indicative list-level prices, not transaction prices. Ratios within a distributor are internally consistent.</li>
  <li><strong>Catering pack formats:</strong> per-100g/100ml figures are computed from each product's stated pack weight or volume (recorded in the register and cross-checked against the distributor's own per-kg unit price where published). Pack sizes differ within some pairs; the pair notes flag where that matters.</li>
  <li><strong>Range gaps are themselves a finding.</strong> JJ lists 28 beef burger lines and no beef-style plant burger (its plant burgers are vegetable or coated chicken-style, so the JJ burger pair compares coated chicken formats). Neither distributor lists a vegan coleslaw, and Brakes lists no vegan mayonnaise. The wholesale plant-based assortment is far thinner than retail.</li>
  <li><strong>No published wholesale benchmark exists for plant-based products.</strong> AHDB publishes weekly GB deadweight (carcase) price series for <a href="https://ahdb.org.uk/beef/gb-deadweight-cattle-prices">cattle</a> and <a href="https://ahdb.org.uk/pork/gb-deadweight-pig-prices-eu-spec">pigs</a>, but a carcase price is a farm-gate commodity price, not comparable to a catering product, and no plant-based equivalent series exists anywhere in its taxonomy.</li>
  <li><strong>Scrape conduct:</strong> both sites are scraped as anonymous visitors from their server-rendered product pages, within each site's robots.txt (Brakes sets a 10-second crawl delay and a 04:00-08:45 UTC visit window; the daily run is paced and scheduled accordingly).</li>
</ul>
<h2>Pair matching notes (wholesale)</h2>
<ul class="checklist">
  ${noteRows}
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
<div class="subtitle">Own-brand and branded pairs at the big UK chains, per 100g/100ml, following and extending the basket in Which? (2022)</div>
${tabs("retail")}
<div class="proto-banner">Updated daily. Series since ${fmtD(firstDate)}; latest prices ${fmtD(lastDate)} (${nDates} day${nDates === 1 ? "" : "s"} of data). Ratios are averages of daily prices over the series.</div>

<div class="key-message">
  <strong>Latest picture (${fmtD(lastDate)})</strong>
  The plant-based premium is category-specific. ${keyMessage()}
</div>

<h2>Price ratio overview: plant-based / meat, per 100g</h2>
<div class="legend">Dot = ratio of plant-based price per 100g to the meat equivalent, averaged over the series; the stem shows the distance from parity (1.0, vertical line).
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
<p>How the plant/meat price ratio moved between the Which? study (average of daily prices, Aug to Oct 2022) and the current series average. The trend is shown in ratios because they are unaffected by general food inflation; nominal per-100g prices are in the table below. Pairs marked * are category-level comparisons where one or both 2022 products have been discontinued or replaced, so those moves partly reflect product turnover, not price changes.</p>
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
<meta name="description" content="Wholesale (foodservice) price comparison of plant-based products and their meat equivalents at UK distributors JJ Foodservice and Brakes, per 100g, updated daily.">
<style>${STYLE}</style>
</head>
<body>

<h1>Plant-based products vs their meat equivalents: UK wholesale (foodservice) price check</h1>
<div class="subtitle">Catering pairs at the two UK foodservice distributors with publicly visible prices, per 100g/100ml</div>
${tabs("wholesale")}
${wLatest.length ? `<div class="proto-banner">Updated daily. Series since ${fmtD(wdates[0])}; latest prices ${fmtD(wLast)} (${wnDates} day${wnDates === 1 ? "" : "s"} of data)${wnDates >= 2 ? ". Ratios are averages of daily prices over the series" : ""}.</div>` : ""}

${wLatest.length ? `<div class="key-message">
  <strong>Latest picture (${fmtD(wLast)})</strong>
  The plant-based premium is category-specific at wholesale too. ${wKeyMessage()}
</div>` : ""}

${wbody}

<h2>Data</h2>
<ul>
  <li>Wholesale daily history: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history_wholesale.json">history_wholesale.json</a> / <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/data/history/history_wholesale.csv">history_wholesale.csv</a> (one row per product, distributor and date, with price basis, branch range, stock and promo fields).</li>
  <li>Pair register with matching decisions: <a href="https://github.com/akanepajs/uk-food/blob/main/scraper/pairs_wholesale.json">pairs_wholesale.json</a>.</li>
  <li>Retail comparison: <a href="retail.html">retail page</a>; code: <a href="https://github.com/akanepajs/uk-food">github.com/akanepajs/uk-food</a>.</li>
</ul>

<div class="disclosure">
  Site prepared with Claude Code (data collection, verification and page build). Prices are list/shelf prices and may have changed. Sources: JJ Foodservice and Brakes product pages (wholesale); AHDB (context links).
  Page generated ${fmtD(wLast || lastDate)}.
</div>

</body>
</html>
`;

// ---- research page ----
// Static content: figures from the plant-based catering cost literature review
// (regenerated from the review's source-locked figure script; every plotted value
// is asserted against the underlying evidence register before the PNG is written).
const rhtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK plant-based vs meat costs: research figures</title>
<meta name="description" content="Figures from the published literature on plant-based vs animal-product food and catering costs: substitution approach, whole-diet patterns, item-level retail gaps and per-meal savings.">
<style>${STYLE}</style>
</head>
<body>

<h1>Plant-based vs animal-product food costs: what the research says</h1>
<div class="subtitle">Figures from a review of the published cost-comparison literature (compiled June to July 2026)</div>
${tabs("research")}

<p>Unlike the Retail and Wholesale tabs, which show this site's own daily price data, this page shows
findings from published studies and reports. Sources are cited below each figure; full references are
at the bottom of the page.</p>

<h2>Cost change by substitution approach</h2>
<div class="fig"><img src="assets/research/fig1_substitution_approach.png" alt="Bar chart: cost reduction by substitution approach, from 1.4% for a like-for-like swap to 45% for a Kantar meat-free meal"></div>
<p class="fignote">A like-for-like analogue swap barely moves meal cost (about 4p per meal, grey bar);
recipe-level and whole-food approaches are usually substantially cheaper. The Springmann et al. (2021)
bars are cells from the study's supplementary data: high-income region cells plus, in teal, the UK
country cell for the flexitarian pattern (17.0% cheaper, 95% CI 13.3 to 18.5). These are modelled retail
prices, not catering prices. The CAWF (2024) basket is a hypothetical UK comparison priced partly on US
dietary data. The France value (Un Plus Bio, 2020) is the ingredient-cost gap between canteens serving a
daily vegetarian option and those serving none. Source: AHDB (2025, reporting Kantar); CAWF (2024);
Springmann et al. (2021); Un Plus Bio (2020).</p>

<h2>Per-meal saving in money (GBP, 2025 prices)</h2>
<div class="fig"><img src="assets/research/fig4_per_meal_saving_gbp2025.png" alt="Bar chart: recipe-level reformulation saves about GBP 0.47 per meal, a like-for-like swap about GBP 0.04"></div>
<p class="fignote">The NYC value is the source-native USD 0.59 per meal (2023, self-reported, a
tray-level comparison), rebased to 2025 GBP using consumer price indices and 2025 exchange rates; the
like-for-like value is the 4p per meal saving reported by AHDB (2025, reporting Kantar) for Great
Britain. The two differ in jurisdiction, setting and method as well as substitution approach, so the
roughly order-of-magnitude gap illustrates the mechanism, not a controlled estimate. Source: NYC Health +
Hospitals (2024); AHDB (2025, reporting Kantar).</p>

<h2>Whole-diet patterns vs the current diet</h2>
<div class="fig"><img src="assets/research/fig2_whole_diet_patterns.png" alt="Range chart: modelled whole-diet cost change by dietary pattern, vegan and vegetarian 20 to 34% cheaper, flexitarian 12 to 17%, pescatarian near parity"></div>
<p class="fignote">Modelled diet costs at International Comparison Program 2017 prices, energy- and
nutrient-matched (Springmann et al., 2021). Shaded bands span the high-veg to high-grain variant range
for the high-income region, from the study's supplementary data (market cost, 2017): vegan 21.5 to 33.6%
cheaper, vegetarian 26.8 to 31.4% cheaper, pescatarian from 2.5% more expensive (high-veg) to near parity
(high-grain, 0.6% cheaper). The flexitarian band (12 to 14%) is the paper's income-group span (14% in
high-income, 12% in upper-middle-income countries); its tick is the high-income cell (13.7%). Diamonds
mark the UK (GBR) country cells: flexitarian 17.0% cheaper (95% CI 13.3 to 18.5), vegetarian 26.5 and
30.9%, vegan 20.8 and 33.3%, pescatarian 1.9 and 5.4% cheaper with both confidence intervals spanning
zero (read as parity). Bands are variant ranges, not confidence intervals; values are modelled retail
prices, not catering prices. Source: Springmann et al. (2021), including the study's supplementary data.</p>

<h2>Item-level price gaps (UK retail, 2024 to 2026)</h2>
<div class="fig"><img src="assets/research/fig3_item_substitutes.png" alt="Diverging bar chart: plant meatballs 41% and mince 13% cheaper, plant burgers 9% and plant milk 16 to 67% more expensive"></div>
<p class="fignote">Mince, meatball and burger figures are from a Tesco price snapshot, January to March
2026, one retailer and one quarter, during a period of rising meat prices in which beef rose fastest
(supermarket beef prices up more than 10% year on year at the time, lean beef mince up 23%) (GFI Europe,
2026); the mince bar compares against beef mince specifically. Milk and cream figures are from retail
data (GFI Europe, 2025, based on Circana retail sales and NIQ Homescan panel data): the overall
per-litre plant-milk premium (67%) is mostly a
branding-mix artefact, since branded-versus-branded the gap is 16% and branded plant cream is near parity
(1.6% more expensive). Source: GFI Europe (2026, mince and meatballs); GFI Europe (2025, milk and cream).</p>

<h2>References</h2>
<ul class="refs">
  <li>AHDB (Adamson, V.) (2025). <a href="https://ahdb.org.uk/news/consumer-insight-flexitarian-trends-shifting-diets-and-changing-preferences">Flexitarian trends: shifting diets and changing preferences</a>. AHDB Consumer Insight, 22 May 2025. Data: Kantar Usage panel, total main meal occasions, 52 weeks ending 23 February 2025 (GB).</li>
  <li>Conservative Animal Welfare Foundation (2024, 27 January). <a href="https://www.conservativeanimalwelfarefoundation.org/wp-content/uploads/2024/01/2-Billion-NHS-Windfall-CAWF.pdf">The &pound;2 billion NHS windfall: Why meat reduction matters</a>.</li>
  <li>Good Food Institute Europe (2025). <a href="https://gfieurope.org/wp-content/uploads/2025/06/UK-plant-based-food-retail-market-insights-2022-2024.pdf">UK plant-based food retail market insights: 2022 to January 2025</a>. Based on Circana retail sales data and NIQ Homescan household panel data.</li>
  <li>Good Food Institute Europe (2026). <a href="https://gfieurope.org/blog/plant-based-mince-and-meatballs-33-cheaper-than-meat-versions-at-uks-largest-retailer-amid-rising-meat-prices/">Plant-based mince and meatballs 33% cheaper than meat versions at UK's largest retailer amid rising meat prices</a>. 29 April 2026.</li>
  <li>NYC Health + Hospitals (2024). <a href="https://www.nychealthandhospitals.org/pressrelease/nyc-health-hospitals-celebrates-1-2-million-plant-based-meals-served/">NYC Health + Hospitals celebrates 1.2 million plant-based meals served</a>. Press release, 14 March 2024.</li>
  <li>Springmann, M., Clark, M. A., Rayner, M., Scarborough, P., &amp; Webb, P. (2021). <a href="https://www.thelancet.com/journals/lanplh/article/PIIS2542-5196(21)00251-5/fulltext">The global and regional costs of healthy and sustainable dietary patterns: a modelling study</a>. The Lancet Planetary Health, 5(11), e797-e807. doi:10.1016/S2542-5196(21)00251-5</li>
  <li>Un Plus Bio (2020). <a href="https://www.unplusbio.org/wp-content/uploads/2020/11/R%C3%A9sultats-2020-OBSERVATOIRE.pdf">Observatoire national de la restauration collective bio et durable: Resultats de l'enquete 2020</a> [survey report].</li>
</ul>

<div class="disclosure">
  Page prepared with Claude Code (literature review, figure generation and page build).
  Page generated ${fmtD(lastDate)}.
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
