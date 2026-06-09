# Centris.ca Scraper

## Setup

```bash
pip install playwright httpx
playwright install chromium
```

## Usage

```bash
# Discover the exact API calls Centris makes (opens real browser)
python centris.py --intercept

# Scrape summaries only (fast — no detail pages)
python centris.py

# Scrape summaries + full specs from each listing page (slow)
python centris.py --detail

# One area only
python centris.py --area montreal
python centris.py --area gatineau --detail
```

## Output

Two files per run:
- `centris_montreal_gatineau_YYYYMMDD_HHMM.json`
- `centris_montreal_gatineau_YYYYMMDD_HHMM.csv`

## Fields

| Field | Notes |
|---|---|
| `centris_no` | MLS number |
| `url` | Listing URL |
| `area` | Montréal / Gatineau |
| `address` | Street address |
| `city` | Municipality |
| `property_type` | Residential, Condo, Plex, etc. |
| `price` | CAD, integer |
| `bedrooms` | From detail page |
| `bathrooms` | From detail page |
| `living_area_sqft` | From detail page |
| `lot_area_sqft` | From detail page |
| `year_built` | From detail page |
| `parking` | Spaces |
| `latitude` / `longitude` | From search API |
| `description` | First 600 chars |

## How it works

Centris is a React SPA. The `q=` parameter in the URL is **gzip-compressed JSON**
(base64url encoded) containing the search filters. Once decoded, the format is:

```json
{
  "fieldsValues": [
    {"fieldId": "Category",    "value": "Residential"},
    {"fieldId": "SellingType", "value": "Sale"},
    {"fieldId": "SalePrice",   "value": "200000"},
    {"fieldId": "SalePrice",   "value": "800000"}
  ]
}
```

The scraper re-encodes this and POSTs it to Centris's internal search API,
bypassing the browser entirely for Phase 1. Phase 2 (detail pages) uses a
headless Chromium browser via Playwright.

## Adjusting filters

Edit `BASE_FILTER` in `centris.py`:

```python
# Add a price range:
{"fieldId": "SalePrice", "value": "300000"},   # min
{"fieldId": "SalePrice", "value": "750000"},   # max

# Condos only:
{"fieldId": "Category", "value": "Condo"},

# Minimum bedrooms:
{"fieldId": "BedroomTotal", "value": "3"},
```

## Notes

- Phase 1 (API) is fast and polite (~1 call/s).  
- Phase 2 (detail pages) adds ~1 s/listing — for 500 listings ≈ 8 min.  
- Run `--intercept` first if the search API endpoint changes; Centris has
  updated their internal routes before.
