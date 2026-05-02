# Scraper Architecture & Full Supabase Schema
## BDO + BPI Buena Mano → Postgres pipeline + complete RN Expo backend

---

## Part 1 — Scraper Architecture

### 1.1 Design principles

Every choice below traces back to one of these:

1. **Idempotent.** Re-running a scrape on the same data must not create duplicates. Achieved with `(source, source_listing_id)` as a natural key.
2. **Auditable.** Every listing state change is traceable. Achieved with raw snapshots in object storage and an append-only price history.
3. **Two-stage write.** Scrapers never write directly to the user-facing `listings` table. They write to `scraping_staging`, and a separate promotion step validates and merges. This means a buggy scraper can never destroy production data.
4. **Polite.** One request every few seconds per source, real `User-Agent`, respect for `robots.txt`, retry with backoff on errors.
5. **Resilient to layout changes.** Selectors are isolated per-source in tiny adapter modules. When BDO changes its HTML, you fix one adapter, not the whole pipeline.

### 1.2 Overall pipeline

```
                 ┌───────────────────────────────────────────────────┐
                 │  SCHEDULER  (cron / GitHub Actions / pg_cron)     │
                 └─────────────────────┬─────────────────────────────┘
                                       │ kicks off worker(s)
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  WORKER  (Python container on Fly.io / Render / Railway) │
        │                                                          │
        │   ┌──────────┐   ┌────────────┐   ┌──────────────┐       │
        │   │ BDO      │   │ BPI Buena  │   │ ...other     │       │
        │   │ adapter  │   │ Mano       │   │ adapters     │       │
        │   │ (Playwr.)│   │ adapter    │   │              │       │
        │   └────┬─────┘   └─────┬──────┘   └──────┬───────┘       │
        │        │               │                 │               │
        │        ▼               ▼                 ▼               │
        │      raw HTML / PDF / JSON snapshots                     │
        └─────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
              ┌─────────────────────────────────────────┐
              │ Supabase Storage  (immutable snapshots) │
              └─────────────────────────────────────────┘
                                  │
                                  ▼
              ┌─────────────────────────────────────────┐
              │ Parser/Normalizer (Python, in worker)   │
              │  • parse to canonical shape             │
              │  • validate with pydantic               │
              │  • upsert into scraping_staging         │
              └─────────────────────┬───────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │ promote_listings()  (Postgres function) │
              │  • diff staging vs production           │
              │  • write to listing_price_history       │
              │  • upsert listings                      │
              │  • mark stale rows as 'sold/withdrawn'  │
              └─────────────────────┬───────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │ Geocoding queue (separate worker)       │
              │  • picks rows where location is null    │
              │  • Google/Mapbox geocode                │
              │  • writes back to listings              │
              └─────────────────────┬───────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │ Notifications (Supabase Edge Function)  │
              │  • triggered on price-drop / new listing│
              │  • Expo push to subscribed users        │
              └─────────────────────────────────────────┘
```

### 1.3 Hosting options

For the worker, pick one based on your operational comfort:

| Option | Pros | Cons |
|---|---|---|
| **Fly.io machine + cron** | Cheap (~$5/mo), full Linux, easy Playwright | Requires a bit of config |
| **Render Cron Job** | Web-UI, simple | Limited runtime (~30 min free tier) |
| **GitHub Actions on schedule** | Free for public/private up to a quota | Hard ceiling of 6 hr/job, awkward for stateful work |
| **Self-hosted VPS** | Total control | You maintain the machine |
| **Supabase Edge Functions** | Same ecosystem | Cannot run Playwright (no Chromium); only good for the API-easy sources |

**Recommendation for MVP:** one Fly.io machine running a Python container, scheduled via a thin `cron` line. Costs ~$5/mo and runs Playwright comfortably. When you outgrow it, split each adapter into its own service.

### 1.4 Source-specific strategies

#### BDO (`bdo.com.ph/personal/assets-for-sale/real-estate`)

The page is an Adobe Experience Manager SPA — the HTML you see in `view-source:` does **not** contain the listings. Listings are loaded by client-side JavaScript via an AJAX call to a JSON endpoint. There are two ways to handle this:

1. **Find the JSON endpoint** by opening Chrome DevTools → Network tab and watching for an XHR/fetch as the listings render. AEM apps typically expose endpoints like `/bin/...` or `/content/.../jcr:content/...json`. If you find one, your scraper becomes a simple `httpx` call.
2. **Render with Playwright.** Robust against UI rebuilds, but heavier.

I recommend doing (1) once during development and falling back to (2) only if BDO removes or auths the endpoint. The reference implementation below shows the Playwright path because it always works.

#### BPI Buena Mano (`buenamano.ph` + `bpi.com.ph` bid PDFs)

Two complementary sources:

- **`buenamano.ph`** — has the property browser. Same Playwright-or-find-the-API pattern.
- **`bpi.com.ph` monthly bid PDFs** — every month BPI publishes a PDF "bid form" with the canonical list of properties open for sealed bidding that cycle. PDF extraction with `pdfplumber` is straightforward because the tables are structured.

The bid PDFs are the more reliable feed because they contain the **bidding deadline** and **minimum bid price**, which the website doesn't always display cleanly. Scrape the PDFs primary, the website secondary, and reconcile.

**Crucial BPI feature: the Green/Yellow/Red tag system.** Buena Mano classifies every property by risk:

| Tag | Meaning |
|---|---|
| 🟢 **Green** | Clean title, registered to bank, ready to transfer |
| 🟡 **Yellow** | Special concerns (consolidation in process, occupancy, technical errors) |
| 🔴 **Red** | Legal issues (court cases, adverse claims, lis pendens) |

Capture this verbatim. Map to your `risk_tier` enum.

### 1.5 Project layout

```
scrapers/
├── pyproject.toml
├── Dockerfile
├── fly.toml
├── src/
│   ├── __init__.py
│   ├── settings.py            # env, secrets, Supabase client
│   ├── models.py              # pydantic shapes (CanonicalListing, etc.)
│   ├── http.py                # shared httpx client w/ retries + UA
│   ├── browser.py             # Playwright pool
│   ├── storage.py             # Supabase Storage (snapshot upload)
│   ├── staging.py             # scraping_staging upsert
│   ├── runner.py              # orchestration; CLI entrypoint
│   ├── geocode.py             # geocoding worker
│   ├── adapters/
│   │   ├── __init__.py        # registry
│   │   ├── base.py            # Adapter ABC
│   │   ├── bdo.py
│   │   └── bpi_buenamano.py
│   └── parsers/
│       ├── pdf_table.py       # pdfplumber helpers
│       └── address.py         # Philippine address normaliser
└── tests/
    └── ...
```

### 1.6 Canonical data model (Python side)

Every adapter must produce records of this shape, regardless of source format:

```python
# src/models.py
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, Literal
from pydantic import BaseModel, Field, HttpUrl

PropertyType = Literal[
    "house_and_lot", "condo", "lot_only", "townhouse", "apartment",
    "commercial", "industrial", "agricultural", "warehouse", "other",
]
SaleMode    = Literal["negotiated", "sealed_bidding", "auction"]
Occupancy   = Literal["vacant", "occupied", "unknown"]
TitleStatus = Literal["clean", "with_levy", "with_court_case", "unconsolidated", "annotated", "unknown"]
RiskTier    = Literal["green", "yellow", "red", "unknown"]
Source      = Literal["bdo", "bpi_buenamano", "pagibig", "pnb", "metrobank", "other"]

class CanonicalPhoto(BaseModel):
    url: HttpUrl
    ordering: int = 0

class CanonicalListing(BaseModel):
    source: Source
    source_listing_id: str            # bank's own identifier; stable across runs
    source_url: Optional[HttpUrl]
    title: str
    property_type: PropertyType
    address_raw: str                  # whatever the bank gave us
    barangay: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    region: Optional[str] = None
    lot_area_sqm: Optional[Decimal] = None
    floor_area_sqm: Optional[Decimal] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    price_php: Decimal
    appraised_value_php: Optional[Decimal] = None
    sale_mode: SaleMode
    bidding_starts_at: Optional[datetime] = None
    bidding_ends_at: Optional[datetime] = None
    occupancy_status: Occupancy = "unknown"
    title_status: TitleStatus = "unknown"
    risk_tier: RiskTier = "unknown"
    redemption_until: Optional[date] = None
    photos: list[CanonicalPhoto] = Field(default_factory=list)
    raw_metadata: dict = Field(default_factory=dict)
    snapshot_path: Optional[str] = None   # Supabase Storage key for raw snapshot
```

### 1.7 Adapter base class

```python
# src/adapters/base.py
from abc import ABC, abstractmethod
from typing import AsyncIterator
from src.models import CanonicalListing

class Adapter(ABC):
    name: str             # 'bdo', 'bpi_buenamano', ...
    polite_delay_s: float = 2.0   # min delay between requests

    @abstractmethod
    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        """Yield canonical listings, one at a time."""
        ...
```

### 1.8 BDO adapter (Playwright)

```python
# src/adapters/bdo.py
import asyncio
import re
from decimal import Decimal
from typing import AsyncIterator
from playwright.async_api import async_playwright
from src.adapters.base import Adapter
from src.models import CanonicalListing
from src.storage import save_snapshot
from src.parsers.address import parse_address

PROPERTY_TYPE_MAP = {
    "Residential": "house_and_lot",
    "Commercial":  "commercial",
    "Industrial":  "industrial",
}
SEARCH_URLS = [
    ("Residential", "https://www.bdo.com.ph/personal/assets-for-sale/real-estate/results-page?type=Residential"),
    ("Commercial",  "https://www.bdo.com.ph/personal/assets-for-sale/real-estate/results-page?type=Commercial"),
    ("Industrial",  "https://www.bdo.com.ph/personal/assets-for-sale/real-estate/results-page?type=Industrial"),
]

class BDOAdapter(Adapter):
    name = "bdo"
    polite_delay_s = 3.0

    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (compatible; ForeclosurePHBot/0.1; "
                    "+https://yourapp.example/about)"
                ),
                viewport={"width": 1280, "height": 900},
            )
            try:
                for type_label, url in SEARCH_URLS:
                    async for listing in self._scrape_category(context, type_label, url):
                        yield listing
            finally:
                await browser.close()

    async def _scrape_category(self, context, type_label, url) -> AsyncIterator[CanonicalListing]:
        page = await context.new_page()
        await page.goto(url, wait_until="networkidle", timeout=60_000)
        # Wait until the listing cards have rendered. Selectors below are illustrative —
        # update them by running `await page.content()` once and inspecting the markup.
        await page.wait_for_selector('[data-testid="property-card"], .property-card, article.listing', timeout=20_000)

        # Pagination: BDO uses "Load more" or numbered pagination; click through until
        # the count stops growing.
        prev_count = -1
        for _ in range(50):  # hard cap as a safety
            cards = await page.query_selector_all('[data-testid="property-card"], .property-card, article.listing')
            if len(cards) == prev_count:
                break
            prev_count = len(cards)
            load_more = await page.query_selector('button:has-text("Load More"), button:has-text("Show More")')
            if not load_more:
                break
            await load_more.click()
            await asyncio.sleep(self.polite_delay_s)
            await page.wait_for_load_state("networkidle")

        cards = await page.query_selector_all('[data-testid="property-card"], .property-card, article.listing')
        for card in cards:
            try:
                listing = await self._parse_card(page, card, type_label)
                if listing:
                    yield listing
            except Exception as e:
                # Don't let a single broken card kill the run. Log it.
                print(f"[BDO] skipping card due to parse error: {e}")

        # Save the full page HTML once per category for audit/replay
        html = await page.content()
        await save_snapshot(f"bdo/{type_label.lower()}/{_today_iso()}.html", html.encode("utf-8"))
        await page.close()

    async def _parse_card(self, page, card, type_label) -> CanonicalListing | None:
        async def text(selector):
            el = await card.query_selector(selector)
            return (await el.inner_text()).strip() if el else None

        title = await text('h3, .title, [data-field="title"]')
        address_raw = await text('.address, [data-field="address"]')
        price_text = await text('.price, [data-field="price"]')
        ref = await text('.ref-number, [data-field="ref"]') or await card.get_attribute("data-ref")
        href_el = await card.query_selector("a")
        href = await href_el.get_attribute("href") if href_el else None
        img_el = await card.query_selector("img")
        img_url = await img_el.get_attribute("src") if img_el else None

        if not (title and price_text and ref):
            return None

        price = _parse_php(price_text)
        if price is None:
            return None

        addr = parse_address(address_raw or "")

        return CanonicalListing(
            source="bdo",
            source_listing_id=ref,
            source_url=f"https://www.bdo.com.ph{href}" if href and href.startswith("/") else href,
            title=title,
            property_type=PROPERTY_TYPE_MAP.get(type_label, "other"),
            address_raw=address_raw or "",
            barangay=addr.barangay,
            city=addr.city,
            province=addr.province,
            region=addr.region,
            price_php=price,
            sale_mode="negotiated",          # BDO is overwhelmingly negotiated sale
            occupancy_status="unknown",
            title_status="unknown",
            risk_tier="unknown",
            photos=[{"url": img_url, "ordering": 0}] if img_url else [],
            raw_metadata={"category": type_label},
        )


_PRICE_RE = re.compile(r"[\d,]+(?:\.\d+)?")
def _parse_php(text: str) -> Decimal | None:
    if not text:
        return None
    m = _PRICE_RE.search(text.replace("\u20b1", "").replace("PHP", "").replace("Php", ""))
    if not m:
        return None
    try:
        return Decimal(m.group(0).replace(",", ""))
    except Exception:
        return None

def _today_iso() -> str:
    from datetime import date
    return date.today().isoformat()
```

> Selectors are deliberately broad. **Run the scraper once locally, dump `await page.content()` for one card, and tighten the selectors before deploying.** Build the test suite around HTML fixtures so you can detect breakage instantly.

### 1.9 BPI Buena Mano adapter (PDF + web)

The PDF path is more deterministic. Here's the parser sketch:

```python
# src/adapters/bpi_buenamano.py
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import AsyncIterator
import httpx
import pdfplumber
from io import BytesIO
from src.adapters.base import Adapter
from src.models import CanonicalListing
from src.parsers.address import parse_address
from src.storage import save_snapshot

# Discovered by visiting bpi.com.ph monthly news posts. You'll maintain a small
# index of "current bidding cycle" PDFs; one approach is to scrape the bpi.com.ph
# news listings for posts containing "Buena Mano" and grab the PDF link.

class BPIBuenaManoAdapter(Adapter):
    name = "bpi_buenamano"
    polite_delay_s = 3.0

    def __init__(self, bid_pdf_url: str, bidding_starts_at: datetime, bidding_ends_at: datetime):
        self.bid_pdf_url = bid_pdf_url
        self.bidding_starts_at = bidding_starts_at
        self.bidding_ends_at = bidding_ends_at

    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(
                self.bid_pdf_url,
                headers={"User-Agent": "ForeclosurePHBot/0.1 (+https://yourapp.example/about)"},
            )
            resp.raise_for_status()
            pdf_bytes = resp.content
            await save_snapshot(
                f"bpi_buenamano/{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf",
                pdf_bytes,
            )

        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for tbl in tables:
                    for row in self._iter_rows(tbl):
                        listing = self._row_to_listing(row)
                        if listing:
                            yield listing

    def _iter_rows(self, tbl):
        # Skip header rows. Buena Mano bid forms typically have a header like:
        # ['Property Code', 'Property Address', 'Tag', 'Lot Area (sqm)',
        #  'Floor Area (sqm)', 'Minimum Bid Price', 'Sales Officer', 'Contact']
        # Identify it by detecting "Property Code" in the row.
        seen_header = False
        for row in tbl:
            if not seen_header:
                if any(cell and "Property Code" in cell for cell in row):
                    seen_header = True
                continue
            if all((c is None or not c.strip()) for c in row):
                continue
            yield row

    def _row_to_listing(self, row) -> CanonicalListing | None:
        cells = [(c or "").strip() for c in row]
        if len(cells) < 6:
            return None
        ref, address_raw, tag_raw, lot_area, floor_area, price_text = cells[:6]
        if not (ref and address_raw and price_text):
            return None

        addr = parse_address(address_raw)
        risk = _tag_to_risk_tier(tag_raw)
        title_status, occupancy = _tag_to_title_and_occupancy(tag_raw)

        price = _parse_php(price_text)
        if price is None:
            return None

        return CanonicalListing(
            source="bpi_buenamano",
            source_listing_id=ref,
            source_url="https://www.buenamano.ph",
            title=address_raw[:140],
            property_type=_guess_property_type(address_raw),
            address_raw=address_raw,
            barangay=addr.barangay,
            city=addr.city,
            province=addr.province,
            region=addr.region,
            lot_area_sqm=_to_decimal(lot_area),
            floor_area_sqm=_to_decimal(floor_area),
            price_php=price,
            sale_mode="sealed_bidding",
            bidding_starts_at=self.bidding_starts_at,
            bidding_ends_at=self.bidding_ends_at,
            occupancy_status=occupancy,
            title_status=title_status,
            risk_tier=risk,
            raw_metadata={"tag_raw": tag_raw},
        )


_PRICE_RE = re.compile(r"[\d,]+(?:\.\d+)?")
def _parse_php(text: str) -> Decimal | None:
    m = _PRICE_RE.search((text or "").replace("\u20b1", "").replace(",", ""))
    return Decimal(m.group(0)) if m else None

def _to_decimal(s: str) -> Decimal | None:
    try:
        return Decimal((s or "").replace(",", "")) if s else None
    except Exception:
        return None

def _tag_to_risk_tier(tag: str):
    t = tag.lower()
    if "green" in t: return "green"
    if "yellow" in t: return "yellow"
    if "red" in t: return "red"
    return "unknown"

def _tag_to_title_and_occupancy(tag: str):
    t = tag.lower()
    title_status, occupancy = "unknown", "unknown"
    if "green" in t:
        title_status = "clean"
    if "consolidat" in t:
        title_status = "unconsolidated"
    if "court" in t or "lis pendens" in t or "adverse" in t:
        title_status = "with_court_case"
    if "no possession" in t or "occupant" in t or "tenant" in t or "settler" in t:
        occupancy = "occupied"
    if "vacant" in t:
        occupancy = "vacant"
    return title_status, occupancy

def _guess_property_type(address_raw: str):
    a = address_raw.lower()
    if "condominium" in a or "condo" in a or "unit " in a: return "condo"
    if "townhouse" in a: return "townhouse"
    if "apartment" in a: return "apartment"
    if "warehouse" in a: return "warehouse"
    if "lot only" in a or "vacant lot" in a: return "lot_only"
    if "commercial" in a: return "commercial"
    if "agricultural" in a: return "agricultural"
    return "house_and_lot"
```

### 1.10 The runner

```python
# src/runner.py
import asyncio
import os
from datetime import datetime, timezone
from src.adapters.bdo import BDOAdapter
from src.adapters.bpi_buenamano import BPIBuenaManoAdapter
from src.staging import upsert_to_staging, finalize_run, start_run
from src.settings import get_supabase

ADAPTERS = [
    lambda: BDOAdapter(),
    # The BPI URL + cycle dates would come from a small "discovery" step that
    # scrapes bpi.com.ph for the current cycle's bid PDF.
    lambda: BPIBuenaManoAdapter(
        bid_pdf_url=os.environ["BPI_CURRENT_BID_PDF"],
        bidding_starts_at=datetime.fromisoformat(os.environ["BPI_BID_START"]),
        bidding_ends_at=datetime.fromisoformat(os.environ["BPI_BID_END"]),
    ),
]

async def main():
    sb = get_supabase()
    for factory in ADAPTERS:
        adapter = factory()
        run_id = await start_run(sb, adapter.name)
        count, errors = 0, 0
        try:
            async for listing in adapter.scrape():
                try:
                    await upsert_to_staging(sb, run_id, listing)
                    count += 1
                except Exception as e:
                    errors += 1
                    print(f"[{adapter.name}] staging upsert error: {e}")
        except Exception as e:
            print(f"[{adapter.name}] adapter crashed: {e}")
            await finalize_run(sb, run_id, status="failed", count=count, errors=errors)
            continue
        await finalize_run(sb, run_id, status="ok", count=count, errors=errors)
        # Promote (calls a Postgres function — see schema)
        sb.rpc("promote_listings", {"p_source": adapter.name, "p_run_id": str(run_id)}).execute()

if __name__ == "__main__":
    asyncio.run(main())
```

### 1.11 Snapshot storage

Every raw HTML/PDF is uploaded to a private Supabase Storage bucket named `scrape-snapshots`. Path convention: `{source}/{YYYYMMDD}/{filename}`. This gives you full replay if a scraper produces bad data — you can re-parse historical snapshots without re-hitting the bank.

### 1.12 Geocoding (separate worker)

Geocoding is rate-limited and metered, so it deserves its own queue. After promotion, rows where `location IS NULL` go into a queue table. A separate cron-driven worker pops 50 at a time, calls Google Geocoding API or Mapbox, and writes back. Cap daily spend with a counter.

### 1.13 Politeness, robots.txt, and legal posture

- Read each source's `robots.txt` and respect `Disallow` paths.
- Identify your bot honestly with a contactable User-Agent.
- One request every 2–3 seconds per host, never concurrent against the same host.
- Cache aggressively on your side; never re-fetch what you already have.
- Treat each source's content as **theirs**. Store only what you need to surface to your users (factual property data and a citation/link back to the bank). Do not republish photos at full resolution; thumbnail them and always deep-link to the bank's listing page for the canonical version.
- Put a public "How we source listings" page on your site naming each bank, linking to their official listing page, and providing a clear contact email for takedown requests.

### 1.14 Observability

The minimum:

- `scrape_runs` table (defined below) captures per-run status, count, errors, duration.
- A weekly Slack/email digest from a tiny Edge Function that reads `scrape_runs` and reports breakage.
- Sentry for unhandled exceptions in the worker.

---

## Part 2 — Full Supabase Schema

This is everything: extensions, types, tables, indexes, triggers, RLS, RPCs, and storage bucket policies. Paste it into the Supabase SQL editor in order.

### 2.1 Extensions and enum types

```sql
-- 01_extensions.sql
create extension if not exists "uuid-ossp";
create extension if not exists postgis;
create extension if not exists pg_trgm;        -- fuzzy text search on addresses
create extension if not exists pg_cron;        -- scheduled SQL jobs (Supabase has this)

-- Enums. Keep these in lockstep with the pydantic Literal types in the scraper.
do $$ begin
  create type property_type as enum (
    'house_and_lot','condo','lot_only','townhouse','apartment',
    'commercial','industrial','agricultural','warehouse','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_mode as enum ('negotiated','sealed_bidding','auction');
exception when duplicate_object then null; end $$;

do $$ begin
  create type occupancy_status as enum ('vacant','occupied','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_status as enum (
    'clean','with_levy','with_court_case','unconsolidated','annotated','unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_tier as enum ('green','yellow','red','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_status as enum ('active','sold','withdrawn','pending','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type save_status as enum (
    'watching','shortlist','inspecting','offered','won','rejected','archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type scrape_run_status as enum ('running','ok','failed','partial');
exception when duplicate_object then null; end $$;
```

### 2.2 Core listings tables

```sql
-- 02_listings.sql

-- Production listings (user-facing).
create table if not exists public.listings (
  id                  uuid primary key default uuid_generate_v4(),
  source              text not null,
  source_listing_id   text not null,
  source_url          text,
  title               text not null,
  property_type       property_type not null default 'other',
  address_raw         text not null,
  barangay            text,
  city                text,
  province            text,
  region              text,
  location            geography(Point, 4326),  -- lat/lng; null until geocoded
  lot_area_sqm        numeric(12,2),
  floor_area_sqm      numeric(12,2),
  bedrooms            int,
  bathrooms           int,
  price_php           numeric(15,2) not null check (price_php >= 0),
  appraised_value_php numeric(15,2) check (appraised_value_php >= 0),
  sale_mode           sale_mode not null default 'negotiated',
  bidding_starts_at   timestamptz,
  bidding_ends_at     timestamptz,
  occupancy           occupancy_status not null default 'unknown',
  title_state         title_status not null default 'unknown',
  risk_tier           risk_tier not null default 'unknown',
  redemption_until    date,
  status              listing_status not null default 'active',
  raw_metadata        jsonb not null default '{}'::jsonb,
  first_seen_at       timestamptz not null default now(),
  last_verified_at    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint listings_source_listing_uk unique (source, source_listing_id)
);

-- Generated columns: useful derived fields, computed on write.
alter table public.listings
  add column if not exists price_per_sqm numeric(15,2)
    generated always as (
      case
        when coalesce(floor_area_sqm, lot_area_sqm) > 0
          then price_php / coalesce(floor_area_sqm, lot_area_sqm)
        else null
      end
    ) stored,
  add column if not exists discount_pct numeric(6,2)
    generated always as (
      case
        when appraised_value_php is not null and appraised_value_php > 0
          then 100.0 * (appraised_value_php - price_php) / appraised_value_php
        else null
      end
    ) stored;

-- Photos
create table if not exists public.listing_photos (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  url         text not null,
  ordering    int not null default 0,
  created_at  timestamptz not null default now()
);

-- Append-only price history. Used for "price drop" notifications and trend charts.
create table if not exists public.listing_price_history (
  id          bigserial primary key,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  price_php   numeric(15,2) not null,
  observed_at timestamptz not null default now()
);

-- Trigger: keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- Trigger: append to price_history when price changes
create or replace function public.record_price_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.price_php <> old.price_php then
    insert into public.listing_price_history (listing_id, price_php, observed_at)
    values (new.id, new.price_php, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_listings_price_history on public.listings;
create trigger trg_listings_price_history after insert or update of price_php
  on public.listings for each row execute function public.record_price_change();
```

### 2.3 Indexes

```sql
-- 03_indexes.sql
create index if not exists idx_listings_status_active
  on public.listings (status) where status = 'active';

create index if not exists idx_listings_city_price
  on public.listings (city, price_php) where status = 'active';

create index if not exists idx_listings_property_type
  on public.listings (property_type) where status = 'active';

create index if not exists idx_listings_sale_mode_deadline
  on public.listings (sale_mode, bidding_ends_at) where status = 'active';

create index if not exists idx_listings_risk_tier
  on public.listings (risk_tier) where status = 'active';

create index if not exists idx_listings_location_gist
  on public.listings using gist (location) where status = 'active';

create index if not exists idx_listings_address_trgm
  on public.listings using gin (address_raw gin_trgm_ops);

create index if not exists idx_listings_discount
  on public.listings (discount_pct desc nulls last) where status = 'active';

create index if not exists idx_photos_listing
  on public.listing_photos (listing_id, ordering);

create index if not exists idx_price_history_listing_observed
  on public.listing_price_history (listing_id, observed_at desc);
```

### 2.4 Scraper-side tables

```sql
-- 04_scraping.sql

-- Per-run audit log
create table if not exists public.scrape_runs (
  id           uuid primary key default uuid_generate_v4(),
  source       text not null,
  status       scrape_run_status not null default 'running',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  count        int not null default 0,
  errors       int not null default 0,
  notes        text
);
create index if not exists idx_scrape_runs_source_started
  on public.scrape_runs (source, started_at desc);

-- Staging table: scrapers ONLY write here.
create table if not exists public.scraping_staging (
  run_id              uuid not null references public.scrape_runs(id) on delete cascade,
  source              text not null,
  source_listing_id   text not null,
  payload             jsonb not null,           -- the full CanonicalListing as JSON
  parse_warnings      text[] not null default '{}',
  created_at          timestamptz not null default now(),
  primary key (run_id, source, source_listing_id)
);
create index if not exists idx_staging_source on public.scraping_staging (source);

-- Review queue: rows that fail validation or look ambiguous.
-- Surface this in an admin web UI for a human to confirm.
create table if not exists public.listing_review_queue (
  id            uuid primary key default uuid_generate_v4(),
  source        text not null,
  source_listing_id text not null,
  payload       jsonb not null,
  reason        text not null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolution    text
);

-- Geocoding queue
create table if not exists public.geocoding_queue (
  listing_id    uuid primary key references public.listings(id) on delete cascade,
  address_raw   text not null,
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

-- When a listing is created without a location, queue it.
create or replace function public.enqueue_geocoding()
returns trigger language plpgsql as $$
begin
  if new.location is null and new.address_raw is not null then
    insert into public.geocoding_queue (listing_id, address_raw)
    values (new.id, new.address_raw)
    on conflict (listing_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_listings_enqueue_geocoding on public.listings;
create trigger trg_listings_enqueue_geocoding after insert on public.listings
  for each row execute function public.enqueue_geocoding();
```

### 2.5 The `promote_listings` function — the core merge logic

```sql
-- 05_promote.sql

create or replace function public.promote_listings(p_source text, p_run_id uuid)
returns table (inserted int, updated int, retired int, queued int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
  v_retired  int := 0;
  v_queued   int := 0;
begin
  -- 1) Upsert active listings from staging into production.
  with src as (
    select
      s.source,
      s.source_listing_id,
      (s.payload->>'source_url')                              as source_url,
      (s.payload->>'title')                                   as title,
      (s.payload->>'property_type')::property_type            as property_type,
      (s.payload->>'address_raw')                             as address_raw,
      nullif(s.payload->>'barangay','')                        as barangay,
      nullif(s.payload->>'city','')                            as city,
      nullif(s.payload->>'province','')                        as province,
      nullif(s.payload->>'region','')                          as region,
      (s.payload->>'lot_area_sqm')::numeric                    as lot_area_sqm,
      (s.payload->>'floor_area_sqm')::numeric                  as floor_area_sqm,
      (s.payload->>'bedrooms')::int                            as bedrooms,
      (s.payload->>'bathrooms')::int                           as bathrooms,
      (s.payload->>'price_php')::numeric                       as price_php,
      (s.payload->>'appraised_value_php')::numeric             as appraised_value_php,
      (s.payload->>'sale_mode')::sale_mode                     as sale_mode,
      (s.payload->>'bidding_starts_at')::timestamptz           as bidding_starts_at,
      (s.payload->>'bidding_ends_at')::timestamptz             as bidding_ends_at,
      coalesce((s.payload->>'occupancy_status')::occupancy_status,'unknown') as occupancy,
      coalesce((s.payload->>'title_status')::title_status,'unknown')        as title_state,
      coalesce((s.payload->>'risk_tier')::risk_tier,'unknown')             as risk_tier,
      (s.payload->>'redemption_until')::date                   as redemption_until,
      coalesce(s.payload->'raw_metadata', '{}'::jsonb)         as raw_metadata
    from public.scraping_staging s
    where s.source = p_source and s.run_id = p_run_id
  ),
  upserted as (
    insert into public.listings (
      source, source_listing_id, source_url, title, property_type,
      address_raw, barangay, city, province, region,
      lot_area_sqm, floor_area_sqm, bedrooms, bathrooms,
      price_php, appraised_value_php,
      sale_mode, bidding_starts_at, bidding_ends_at,
      occupancy, title_state, risk_tier, redemption_until,
      raw_metadata, last_verified_at, status
    )
    select
      source, source_listing_id, source_url, title, property_type,
      address_raw, barangay, city, province, region,
      lot_area_sqm, floor_area_sqm, bedrooms, bathrooms,
      price_php, appraised_value_php,
      sale_mode, bidding_starts_at, bidding_ends_at,
      occupancy, title_state, risk_tier, redemption_until,
      raw_metadata, now(), 'active'
    from src
    on conflict (source, source_listing_id) do update set
      source_url           = excluded.source_url,
      title                = excluded.title,
      property_type        = excluded.property_type,
      address_raw          = excluded.address_raw,
      barangay             = excluded.barangay,
      city                 = excluded.city,
      province             = excluded.province,
      region               = excluded.region,
      lot_area_sqm         = excluded.lot_area_sqm,
      floor_area_sqm       = excluded.floor_area_sqm,
      bedrooms             = excluded.bedrooms,
      bathrooms            = excluded.bathrooms,
      price_php            = excluded.price_php,
      appraised_value_php  = excluded.appraised_value_php,
      sale_mode            = excluded.sale_mode,
      bidding_starts_at    = excluded.bidding_starts_at,
      bidding_ends_at      = excluded.bidding_ends_at,
      occupancy            = excluded.occupancy,
      title_state          = excluded.title_state,
      risk_tier            = excluded.risk_tier,
      redemption_until     = excluded.redemption_until,
      raw_metadata         = excluded.raw_metadata,
      last_verified_at     = now(),
      -- bring back from sold/withdrawn if the bank re-listed it
      status               = case when listings.status in ('sold','withdrawn','expired')
                                  then 'active' else listings.status end
    returning xmax = 0 as inserted_now
  )
  select
    sum(case when inserted_now then 1 else 0 end)::int,
    sum(case when not inserted_now then 1 else 0 end)::int
  into v_inserted, v_updated
  from upserted;

  -- 2) Mark anything from this source that wasn't seen in the run as withdrawn.
  --    Only mark rows that were 'active'; keep history intact.
  update public.listings l
     set status = 'withdrawn'
   where l.source = p_source
     and l.status = 'active'
     and not exists (
       select 1 from public.scraping_staging s
        where s.run_id = p_run_id
          and s.source = p_source
          and s.source_listing_id = l.source_listing_id
     );
  get diagnostics v_retired = row_count;

  -- 3) Queue rows for geocoding (the trigger handles inserts; we re-queue on
  --    address change for existing rows).
  insert into public.geocoding_queue (listing_id, address_raw)
  select l.id, l.address_raw
    from public.listings l
   where l.source = p_source
     and l.location is null
     and l.address_raw is not null
  on conflict (listing_id) do nothing;
  get diagnostics v_queued = row_count;

  return query select v_inserted, v_updated, v_retired, v_queued;
end $$;
```

### 2.6 User-side tables

```sql
-- 06_users.sql

-- Extends auth.users with profile data
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  phone         text,
  home_lat      double precision,
  home_lng      double precision,
  push_token    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Saves: a user's interest in a listing
create table if not exists public.saves (
  user_id     uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  status      save_status not null default 'watching',
  notes       text,
  rating      int check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);

drop trigger if exists trg_saves_updated_at on public.saves;
create trigger trg_saves_updated_at before update on public.saves
  for each row execute function public.set_updated_at();

create index if not exists idx_saves_user_status on public.saves (user_id, status);

-- Comparison sets (saved sets of 2-4 listings)
create table if not exists public.comparison_sets (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  listing_ids  uuid[] not null check (array_length(listing_ids,1) between 2 and 4),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_comparison_sets_updated_at on public.comparison_sets;
create trigger trg_comparison_sets_updated_at before update on public.comparison_sets
  for each row execute function public.set_updated_at();

-- User-uploaded inspection photos
create table if not exists public.inspection_photos (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,                   -- in the 'inspections' bucket
  taken_at    timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  caption     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_inspection_photos_user_listing
  on public.inspection_photos (user_id, listing_id);

-- Notifications log
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid references public.listings(id) on delete cascade,
  kind        text not null,                    -- 'price_drop' | 'bid_deadline' | 'new_match' | ...
  payload     jsonb not null default '{}'::jsonb,
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user_unsent
  on public.notifications (user_id, sent_at) where sent_at is null;
```

### 2.7 Row Level Security (RLS)

```sql
-- 07_rls.sql

-- Listings, photos, history: world-readable when active. Writes only via service role.
alter table public.listings              enable row level security;
alter table public.listing_photos        enable row level security;
alter table public.listing_price_history enable row level security;

create policy "active listings are public"
  on public.listings for select using (status = 'active');

create policy "photos for active listings are public"
  on public.listing_photos for select
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id and l.status = 'active'
  ));

create policy "price history for active listings is public"
  on public.listing_price_history for select
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id and l.status = 'active'
  ));

-- (No public insert/update/delete policies. Only service_role can write.
--  service_role bypasses RLS by default, so no policy is needed for it.)

-- Profiles: each user sees and edits only their own row.
alter table public.profiles enable row level security;

create policy "profiles select self"   on public.profiles for select
  using (auth.uid() = id);
create policy "profiles update self"   on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles insert self"   on public.profiles for insert
  with check (auth.uid() = id);

-- Saves: per-user CRUD
alter table public.saves enable row level security;

create policy "saves select self"  on public.saves for select using (auth.uid() = user_id);
create policy "saves insert self"  on public.saves for insert with check (auth.uid() = user_id);
create policy "saves update self"  on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saves delete self"  on public.saves for delete using (auth.uid() = user_id);

-- Comparison sets: per-user CRUD
alter table public.comparison_sets enable row level security;

create policy "comparisons select self" on public.comparison_sets for select using (auth.uid() = user_id);
create policy "comparisons insert self" on public.comparison_sets for insert with check (auth.uid() = user_id);
create policy "comparisons update self" on public.comparison_sets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comparisons delete self" on public.comparison_sets for delete using (auth.uid() = user_id);

-- Inspection photos: per-user CRUD
alter table public.inspection_photos enable row level security;

create policy "inspections select self" on public.inspection_photos for select using (auth.uid() = user_id);
create policy "inspections insert self" on public.inspection_photos for insert with check (auth.uid() = user_id);
create policy "inspections update self" on public.inspection_photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "inspections delete self" on public.inspection_photos for delete using (auth.uid() = user_id);

-- Notifications: read-only to the owning user
alter table public.notifications enable row level security;

create policy "notifications select self" on public.notifications for select using (auth.uid() = user_id);
create policy "notifications update self" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Scraping tables: locked down. No public access. Service role only.
alter table public.scrape_runs        enable row level security;
alter table public.scraping_staging   enable row level security;
alter table public.listing_review_queue enable row level security;
alter table public.geocoding_queue    enable row level security;
-- (No policies — service_role bypasses RLS, so it can read/write; everyone else gets nothing.)
```

### 2.8 The search RPC

A single function the app calls for the filtered feed:

```sql
-- 08_search_rpc.sql

create or replace function public.search_listings(
  p_cities          text[]     default null,
  p_property_types  property_type[] default null,
  p_price_min       numeric    default null,
  p_price_max       numeric    default null,
  p_occupancy       occupancy_status[] default null,
  p_title_states    title_status[]    default null,
  p_risk_tiers      risk_tier[]       default null,
  p_sale_mode       sale_mode  default null,
  p_query           text       default null,         -- fuzzy match on address/title
  p_lat             double precision default null,    -- if both lat/lng/radius set,
  p_lng             double precision default null,    -- restrict to within radius
  p_radius_km       double precision default null,
  p_sort            text       default 'discount_pct',-- 'price'|'price_per_sqm'|'discount_pct'|'newest'|'bidding_ends'
  p_limit           int        default 50,
  p_offset          int        default 0
)
returns table (
  id uuid, source text, source_listing_id text, source_url text,
  title text, property_type property_type, address_raw text,
  city text, province text,
  lat double precision, lng double precision,
  lot_area_sqm numeric, floor_area_sqm numeric,
  price_php numeric, appraised_value_php numeric,
  price_per_sqm numeric, discount_pct numeric,
  sale_mode sale_mode, bidding_ends_at timestamptz,
  occupancy occupancy_status, title_state title_status, risk_tier risk_tier,
  thumbnail_url text,
  distance_km double precision
)
language sql
stable
as $$
  with base as (
    select
      l.*,
      st_y(l.location::geometry) as lat,
      st_x(l.location::geometry) as lng,
      (
        select url from public.listing_photos p
         where p.listing_id = l.id order by p.ordering limit 1
      ) as thumbnail_url,
      case
        when p_lat is not null and p_lng is not null and l.location is not null
          then st_distance(
                 l.location,
                 st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
               ) / 1000.0
      end as distance_km
    from public.listings l
    where l.status = 'active'
      and (p_cities         is null or l.city = any(p_cities))
      and (p_property_types is null or l.property_type = any(p_property_types))
      and (p_price_min      is null or l.price_php >= p_price_min)
      and (p_price_max      is null or l.price_php <= p_price_max)
      and (p_occupancy      is null or l.occupancy = any(p_occupancy))
      and (p_title_states   is null or l.title_state = any(p_title_states))
      and (p_risk_tiers     is null or l.risk_tier = any(p_risk_tiers))
      and (p_sale_mode      is null or l.sale_mode = p_sale_mode)
      and (
            p_query is null
         or l.address_raw ilike '%'||p_query||'%'
         or l.title       ilike '%'||p_query||'%'
         or l.address_raw % p_query
      )
      and (
            p_lat is null or p_lng is null or p_radius_km is null or l.location is null
         or st_dwithin(
              l.location,
              st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
              p_radius_km * 1000.0
            )
      )
  )
  select
    id, source, source_listing_id, source_url,
    title, property_type, address_raw, city, province,
    lat, lng, lot_area_sqm, floor_area_sqm,
    price_php, appraised_value_php, price_per_sqm, discount_pct,
    sale_mode, bidding_ends_at,
    occupancy, title_state, risk_tier,
    thumbnail_url, distance_km
  from base
  order by
    case when p_sort = 'price'         then price_php          end asc nulls last,
    case when p_sort = 'price_per_sqm' then price_per_sqm      end asc nulls last,
    case when p_sort = 'discount_pct'  then discount_pct       end desc nulls last,
    case when p_sort = 'newest'        then first_seen_at      end desc nulls last,
    case when p_sort = 'bidding_ends'  then bidding_ends_at    end asc nulls last,
    id
  limit p_limit offset p_offset;
$$;

grant execute on function public.search_listings(
  text[], property_type[], numeric, numeric,
  occupancy_status[], title_status[], risk_tier[], sale_mode,
  text, double precision, double precision, double precision,
  text, int, int
) to anon, authenticated;
```

### 2.9 Notification fan-out

When a price drops, fan out to every user who saved that listing. We do this in SQL and let an Edge Function pick up unsent rows.

```sql
-- 09_notifications.sql

create or replace function public.fanout_price_drop()
returns trigger language plpgsql as $$
declare
  v_listing_id uuid := new.listing_id;
  v_old_price  numeric;
begin
  if tg_op <> 'INSERT' then return new; end if;

  select price_php into v_old_price
    from public.listing_price_history
   where listing_id = v_listing_id and id < new.id
   order by id desc limit 1;

  if v_old_price is null or new.price_php >= v_old_price then
    return new;  -- only fan out on actual drop
  end if;

  insert into public.notifications (user_id, listing_id, kind, payload)
  select s.user_id, v_listing_id, 'price_drop',
         jsonb_build_object('old_price', v_old_price, 'new_price', new.price_php)
    from public.saves s
   where s.listing_id = v_listing_id
     and s.status in ('watching','shortlist','inspecting');

  return new;
end $$;

drop trigger if exists trg_fanout_price_drop on public.listing_price_history;
create trigger trg_fanout_price_drop after insert on public.listing_price_history
  for each row execute function public.fanout_price_drop();
```

The Edge Function (in `supabase/functions/send-push/index.ts`) selects unsent notifications, calls Expo's push API with the recipient's `push_token`, and stamps `sent_at`. Schedule it every minute via `pg_cron`:

```sql
select cron.schedule(
  'send-push-notifications',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-push',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.svc_key'))
     ); $$
);
```

(Or just set up an HTTP cron from outside Supabase — simpler if you don't want to expose service keys to `pg_cron`.)

### 2.10 Storage buckets

```sql
-- 10_storage.sql
-- Create via the Supabase dashboard or via supabase CLI:
--   scrape-snapshots  (private)   - raw HTML/PDF saved by scrapers
--   listing-photos    (public)    - resized thumbnails the app shows
--   inspections       (private)   - user inspection photos

-- Inspection bucket policy: only the owning user can read/write their files.
-- (Configure in Storage → Policies in the Supabase dashboard.)
-- SELECT policy:
--   bucket_id = 'inspections' AND auth.uid()::text = (storage.foldername(name))[1]
-- INSERT/UPDATE/DELETE policy: same.
-- This requires you to upload paths like `${user_id}/${file}`.
```

### 2.11 What the app code looks like against this

Searching from the React Native app:

```ts
// hooks/useFilteredListings.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/stores/filters';

export function useFilteredListings() {
  const f = useFilters();
  return useQuery({
    queryKey: ['listings', f],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_listings', {
        p_cities:         f.cities.length ? f.cities : null,
        p_property_types: f.propertyTypes.length ? f.propertyTypes : null,
        p_price_min:      f.priceMin ?? null,
        p_price_max:      f.priceMax ?? null,
        p_occupancy:      f.occupancy.length ? f.occupancy : null,
        p_title_states:   f.titleStatus.length ? f.titleStatus : null,
        p_risk_tiers:     f.riskTiers.length ? f.riskTiers : null,
        p_sale_mode:      f.saleMode ?? null,
        p_query:          f.query || null,
        p_lat:            f.nearLat ?? null,
        p_lng:            f.nearLng ?? null,
        p_radius_km:      f.radiusKm ?? null,
        p_sort:           f.sortBy,
        p_limit:          50,
        p_offset:         0,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}
```

Saving a listing:

```ts
// hooks/useSave.ts
export async function saveListing(listingId: string, status: 'watching'|'shortlist' = 'watching') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  const { error } = await supabase
    .from('saves')
    .upsert({ user_id: user.id, listing_id: listingId, status })
    .select();
  if (error) throw error;
}
```

Listing the user's saves (RLS handles the `user_id` filter automatically):

```ts
const { data } = await supabase
  .from('saves')
  .select('*, listing:listings(*)')
  .order('updated_at', { ascending: false });
```

### 2.12 Apply the schema in order

```bash
# from a local checkout
supabase db push    # if using Supabase migrations, drop the files in supabase/migrations/

# or, in the Supabase SQL editor, paste in this order:
01_extensions.sql
02_listings.sql
03_indexes.sql
04_scraping.sql
05_promote.sql
06_users.sql
07_rls.sql
08_search_rpc.sql
09_notifications.sql
10_storage.sql       # plus dashboard config
```

---

## Part 3 — Operational checklist before going live

- [ ] BDO and BPI adapters tested against fixture HTML/PDFs in CI.
- [ ] Scraper run logs visible in `scrape_runs`; weekly digest email wired up.
- [ ] Snapshots being written to the `scrape-snapshots` bucket.
- [ ] Geocoding worker running; budget cap in place on Google API key.
- [ ] RLS verified by signing in as two different users in the dashboard's "Authenticated" view and checking neither can read the other's saves.
- [ ] `search_listings` RPC measured with `EXPLAIN ANALYZE` on a 5,000-row dataset — should be <50ms with the indexes above.
- [ ] Push notifications tested end-to-end: drop a row's `price_php`, confirm a `price_drop` notification appears for a user who saved that listing, confirm the Edge Function picks it up and the device receives it.
- [ ] Public "How we source listings" page live, naming each bank, with takedown contact.

That's the full system: a defensible, auditable scraper for two of the largest sources, a Postgres schema that handles the messy realities of Philippine foreclosures, and clean per-user privacy via RLS. The same pattern extends to PNB, Pag-IBIG, Metrobank — each is just a new file under `src/adapters/`.
