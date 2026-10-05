# Food Trace Atlas

Where did my food come from, and is it safe right now? A free, static site that answers with official public data only: every claim sourced and dated, nothing pay-to-play.

Live: https://el9995.github.io/Food-Trace-Atlas/

## Now

- **Recall report (home page):** daily or weekly report of new FDA recall notices, with the product photos FDA publishes. Visitors pick the FDA product types they care about (saved in their browser) and read it as a list or as slides. One RSS feed per product type in `feeds/`.
- **Barcode check (`check.html`, test):** type or scan a barcode to see the product from USDA FoodData Central and any matching FDA recall from openFDA.

## How the data updates

`scripts/fetch_recalls.py` runs in GitHub Actions every 6 hours (`.github/workflows/pages.yml`). It reads FDA's [Recalls, Market Withdrawals, & Safety Alerts](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts) table and each new notice page (for photos), plus [Major Product Recalls](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/major-product-recalls), then commits `data/recalls.json` and `feeds/` and republishes the site. It waits 2 seconds between requests, as FDA's robots.txt asks. Each record keeps its source, source link, retrieval time and "confirmed" status. Photos are linked from FDA.gov, not copied.

Run it locally with `python3 scripts/fetch_recalls.py` (standard library only).

## Data sources

- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide) (free key from api.data.gov; the page falls back to the shared `DEMO_KEY`)
- FDA recall notices and Major Product Recalls pages on FDA.gov (see above)
- [openFDA food enforcement reports](https://open.fda.gov/apis/food/enforcement/) (no key, updated weekly)

Recall notices write barcodes in many formats, so barcode matching can miss recalls. The page always says so and links to FDA.gov and FSIS.usda.gov.

## Roadmap

1. Food recall check by barcode (add USDA FSIS recalls and FDA same-day announcements)
2. Plant-code lookup for meat (EST), milk, eggs and shellfish
3. Origin explainer pages (country-of-origin rules, "Product of USA")
4. Pantry recall alerts, shared with the Neuro Stack Atlas supplement stack alerts

No build step. Open `index.html` through any local web server to preview.
