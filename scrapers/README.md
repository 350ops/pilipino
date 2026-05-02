# Propia Foreclosure Scrapers

Python scraper subsystem for BDO real estate assets and BPI Buena Mano sealed-bidding PDFs.

## Setup

```bash
cd /Users/m/pilipino
python3 -m venv .venv
. .venv/bin/activate
pip install -e "scrapers[test]"
python -m playwright install chromium
```

Required environment variables for persisted runs:

```bash
export SUPABASE_URL="..."
export SUPABASE_SERVICE_ROLE_KEY="..."
export SCRAPE_SNAPSHOT_BUCKET="scrape-snapshots"
export SCRAPER_USER_AGENT="ForeclosurePHBot/0.1 (+mailto:you@example.com)"
```

`SCRAPE_SNAPSHOT_BUCKET` and `SCRAPER_USER_AGENT` are optional. The service role key must only be used by the worker, never by the Expo client.

## Run

Dry-run without Supabase writes:

```bash
python3 -m scrapers.src.runner --source bpi_buenamano --dry-run --snapshot-dir .scrape-snapshots --limit 5
python3 -m scrapers.src.runner --source bdo --dry-run --snapshot-dir .scrape-snapshots --limit 5
```

Persist to Supabase staging and promote:

```bash
python3 -m scrapers.src.runner --source all
```

Scrapers write only to `scraping_staging`; production listing changes happen through `promote_listings(p_source, p_run_id)`.

## Local App Fixture Conversion

The Expo app still reads `assets/data/foreclosures.json`. To regenerate that local fixture from `assets/data/fore.json`:

```bash
python3 scripts/update_foreclosures.py
```
