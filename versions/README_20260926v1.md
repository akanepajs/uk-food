# uk-food.kanepajs.eu

Price comparison of plant-based products and their meat equivalents at the big UK
supermarket chains, per 100g/100ml, following the product basket in Which? (Dec 2022),
"Plant-based alternatives can cost twice as much as meat".

Production pipeline (since 7 July 2026): a daily GitHub Actions run scrapes the curated
pair register, appends to the price-history series, regenerates the page, and redeploys.
Ratios shown on the page are averages of daily prices over the accumulating series (the
Which? benchmark used a three-month average).

## Contents

- `index.html` (research landing page), `retail.html`, `wholesale.html`, `research.html`
  (redirect stub): the site pages (generated; do not edit by hand).
- `scraper/pairs.json`: the curated pair register (slugs, hand-verified pack sizes,
  Sainsbury's API queries, matching decisions).
- `scraper/run_scrape_uk.mjs`: the daily scraper. trolley.co.uk product pages (allowed
  by its robots.txt; search is not used) for all chains, plus Sainsbury's own product
  API as primary source where the product surfaces there. Fail-loud on bot-block or
  3+ product failures: nothing is written and the run goes red.
- `scraper/data/history/history.json` / `history.csv`: the full daily series (one row
  per product, store and date, with provenance).
- `scripts/build_page.mjs`: page generator (all page numbers come from the history).
- `.github/workflows/daily-scrape.yml`: the daily cron (05:40 UTC).
- Wholesale (foodservice) layer, since 7 July 2026: `scraper/pairs_wholesale.json`
  (register), `scraper/run_scrape_wholesale.mjs` (daily scraper: JJ Foodservice
  product-page JSON-LD, ex-VAT Collection prices at the Enfield branch; Brakes
  product-page ng-state, anonymous indicative prices), `scraper/data/history/
  history_wholesale.json` / `.csv` (separate series; wholesale rows never enter the
  retail history), `.github/workflows/daily-scrape-wholesale.yml` (05:10 UTC, inside
  the visit window Brakes' robots.txt requests, 11s request pacing per its crawl-delay).
  Booker, Costco UK (bot-blocked) and Bidfood (account-gated) were probed and excluded.
- Research tab (the landing page `index.html`), since 7 July 2026: findings from a review
  of the published plant-based vs animal-product cost literature, drawn as the same
  HTML lollipop charts as the price tabs plus one shaded table. All research-page numbers
  come from `scripts/research_data.json`, written by a verification script maintained
  outside this repo that asserts every value against the primary sources (Springmann et
  al. 2021 supplementary dataset; the review's evidence register) before export. Notes
  and APA references on the page.
- `CNAME`: custom domain for GitHub Pages.
- `scraper/final_scrape.mjs`, `scraper/mince_scrape.mjs`, `scraper/verify_sains.mjs`,
  `scraper/data/2026-07-06_snapshot.json`, `scraper/data/2026-07-07_mince_meatballs.json`:
  the July 2026 prototype-era one-off scripts and snapshots, kept for provenance.

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
