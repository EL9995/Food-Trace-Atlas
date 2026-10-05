# Food Trace Atlas

Where did my food come from, and is it safe right now? A free, static site that answers with official public data only: every claim sourced and dated, nothing pay-to-play.

Live: https://el9995.github.io/food-trace-atlas/

## Now

- **Food recall check (test):** type or scan a barcode to see the product from USDA FoodData Central and any matching FDA recall from openFDA.

## Data sources

- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide) (free key from api.data.gov; the page falls back to the shared `DEMO_KEY`)
- [openFDA food enforcement reports](https://open.fda.gov/apis/food/enforcement/) (no key, updated weekly)

Recall notices write barcodes in many formats, so barcode matching can miss recalls. The page always says so and links to FDA.gov and FSIS.usda.gov.

## Roadmap

1. Food recall check by barcode (add USDA FSIS recalls and FDA same-day announcements)
2. Plant-code lookup for meat (EST), milk, eggs and shellfish
3. Origin explainer pages (country-of-origin rules, "Product of USA")
4. Pantry recall alerts, shared with the Neuro Stack Atlas supplement stack alerts

No build step. Open `index.html` through any local web server to preview.
