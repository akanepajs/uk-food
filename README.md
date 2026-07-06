# uk-food.kanepajs.eu

Price comparison of plant-based products and their meat equivalents at the big UK
supermarket chains, per 100g/100ml, following the product basket in Which? (Dec 2022),
"Plant-based alternatives can cost twice as much as meat".

Current state: PROTOTYPE. One-day price snapshot (6 July 2026), hand-curated pair
register, static page. Daily scraping, a price-history series, direct retailer sources
(Sainsbury's, Waitrose, Morrisons) and the remaining Which? categories (ready meals,
coleslaw) are planned; see "What the production site adds" on the page.

## Contents

- `index.html`: the site (fully self-contained, no external assets).
- `CNAME`: custom domain for GitHub Pages.
- `scraper/final_scrape.mjs`: the snapshot scraper (trolley.co.uk aggregator, curated
  register of product-page slugs).
- `scraper/verify_sains.mjs`: cross-check of Sainsbury's rows against Sainsbury's own
  product API (primary source).
- `scraper/data/2026-07-06_snapshot.json`: the raw scraped records behind the page.

## Data notes

- Tesco, Asda, Ocado and Co-op block automated access to their own sites; their prices
  come from the trolley.co.uk aggregator (secondary source). Sainsbury's rows are
  verified against the retailer's API.
- Per-100g figures are computed from pack price and pack weight. The aggregator's own
  multipack unit prices are wrong (it multiplies pack count by total pack weight) and
  are not used.
- Shelf prices only; loyalty-card prices and multibuy offers are excluded.

Related: [olas.kanepajs.eu](https://olas.kanepajs.eu) (Latvian egg prices; same site
scaffold and pipeline pattern).

Prepared with Claude Code.
