from __future__ import annotations

import asyncio
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import AsyncIterator, Optional
from urllib.parse import parse_qs, urljoin, urlparse

from scrapers.src.adapters.base import Adapter
from scrapers.src.models import CanonicalListing
from scrapers.src.settings import DEFAULT_USER_AGENT
from scrapers.src.storage import save_snapshot


BASE_URL = "https://www.bdo.com.ph"
RESULTS_URL = f"{BASE_URL}/personal/assets-for-sale/real-estate/results-page"
CARD_SELECTOR = ".swiper-slide, article, .cmp-teaser, .card"
PRICE_RE = re.compile(r"(?:PHP|Php|₱)\s*([\d,]+(?:\.\d+)?)")
AREA_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*sqm", re.I)
PROPERTY_CODE_RE = re.compile(r"propertyCode=([^&#]+)")


PROPERTY_TYPE_MAP = {
    "condominium": "condo",
    "condominium unit": "condo",
    "residential": "house_and_lot",
    "house and lot": "house_and_lot",
    "vacant lot": "lot_only",
    "lot only": "lot_only",
    "commercial": "commercial",
    "industrial": "industrial",
    "agricultural": "agricultural",
    "memorial": "other",
}


class BDOAdapter(Adapter):
    name = "bdo"
    polite_delay_s = 3.0

    def __init__(
        self,
        *,
        user_agent: str = DEFAULT_USER_AGENT,
        supabase_client=None,
        snapshot_bucket: str = "scrape-snapshots",
        snapshot_local_dir: Optional[str] = None,
        max_pages: int = 50,
    ) -> None:
        self.user_agent = user_agent
        self.supabase_client = supabase_client
        self.snapshot_bucket = snapshot_bucket
        self.snapshot_local_dir = snapshot_local_dir
        self.max_pages = max_pages

    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError("Install Playwright and run `python -m playwright install chromium`") from exc

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=self.user_agent,
                viewport={"width": 1280, "height": 900},
            )
            page = await context.new_page()
            try:
                await page.goto(RESULTS_URL, wait_until="networkidle", timeout=60_000)
                await self._load_all_results(page)
                html = await page.content()
                await save_snapshot(
                    f"bdo/{date.today().isoformat()}/results.html",
                    html.encode("utf-8"),
                    supabase_client=self.supabase_client,
                    bucket=self.snapshot_bucket,
                    local_dir=self.snapshot_local_dir,
                )

                cards = await page.query_selector_all(CARD_SELECTOR)
                yielded: set[str] = set()
                for card in cards:
                    text = await card.inner_text()
                    href = await _first_link_href(card)
                    if not href:
                        continue
                    source_url = urljoin(BASE_URL, href)
                    listing = parse_bdo_card_text(text=text, source_url=source_url)
                    if not listing or listing.source_listing_id in yielded:
                        continue
                    yielded.add(listing.source_listing_id)
                    yield listing
            finally:
                await browser.close()

    async def _load_all_results(self, page) -> None:
        previous_count = -1
        for _ in range(self.max_pages):
            links = await page.query_selector_all('a[href*="propertyCode="]')
            current_count = len(links)
            if current_count == previous_count:
                break
            previous_count = current_count
            button = await page.query_selector('button:has-text("Load More"), button:has-text("Show More")')
            if not button:
                break
            await button.click()
            await asyncio.sleep(self.polite_delay_s)
            await page.wait_for_load_state("networkidle")


async def _first_link_href(card) -> Optional[str]:
    link = await card.query_selector('a[href*="propertyCode="]')
    if not link:
        return None
    return await link.get_attribute("href")


def parse_bdo_card_text(*, text: str, source_url: str) -> Optional[CanonicalListing]:
    source_listing_id = extract_property_code(source_url)
    price = parse_php(text)
    if not source_listing_id or price is None:
        return None

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = _find_title(lines)
    if not title:
        return None

    property_type = guess_property_type(" ".join(lines))
    floor_area = _area_for_label(lines, "floor")
    lot_area = _area_for_label(lines, "lot")

    return CanonicalListing(
        source="bdo",
        source_listing_id=source_listing_id,
        source_url=source_url,
        title=title,
        property_type=property_type,
        address_raw=title,
        lot_area_sqm=lot_area,
        floor_area_sqm=floor_area,
        price_php=price,
        sale_mode="negotiated",
        raw_metadata={"card_text": text},
    )


def extract_property_code(url: str) -> Optional[str]:
    parsed = urlparse(url)
    code = parse_qs(parsed.query).get("propertyCode")
    if code and code[0]:
        return code[0]
    match = PROPERTY_CODE_RE.search(url)
    return match.group(1) if match else None


def parse_php(text: str) -> Optional[Decimal]:
    match = PRICE_RE.search(text or "")
    if not match:
        return None
    try:
        return Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:
        return None


def parse_area_sqm(text: str) -> Optional[Decimal]:
    match = AREA_RE.search(text or "")
    if not match:
        return None
    try:
        return Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:
        return None


def guess_property_type(text: str):
    lower = text.lower()
    if "condominium" in lower or "condo" in lower:
        return "condo"
    if "townhouse" in lower:
        return "townhouse"
    if "warehouse" in lower:
        return "warehouse"
    if "industrial" in lower:
        return "industrial"
    if "agricultural" in lower:
        return "agricultural"
    if "commercial" in lower:
        return "commercial"
    if "vacant lot" in lower or "lot only" in lower:
        return "lot_only"
    if "residential" in lower:
        return "house_and_lot"
    return "other"


def _find_title(lines: list[str]) -> Optional[str]:
    for line in lines:
        lower = line.lower()
        if lower == "sale" or "php" in lower or "sqm" in lower:
            continue
        if lower in PROPERTY_TYPE_MAP:
            continue
        return line
    return None


def _area_for_label(lines: list[str], label: str) -> Optional[Decimal]:
    for line in lines:
        if label in line.lower():
            area = parse_area_sqm(line)
            if area is not None:
                return area
    return None
