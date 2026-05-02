from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import AsyncIterator, Iterable, Optional
from urllib.parse import urljoin

from scrapers.src.adapters.base import Adapter
from scrapers.src.adapters.bdo import parse_php
from scrapers.src.models import CanonicalListing
from scrapers.src.settings import DEFAULT_USER_AGENT
from scrapers.src.storage import save_snapshot


BUENAMANO_URL = "https://www.bpi.com.ph/group/buenamano"
PHILIPPINES_TZ = timezone(timedelta(hours=8))
PDF_HREF_RE = re.compile(r'href=["\']([^"\']+\.pdf)["\']', re.I)
BID_RANGE_RE = re.compile(
    r"Start of bidding:\s*([A-Za-z]+ \d{1,2}, \d{4}) at ([\d:]+ [AP]M) to "
    r"([A-Za-z]+ \d{1,2}, \d{4}) at ([\d:]+ [AP]M)",
    re.I,
)


@dataclass(frozen=True)
class DiscoveredBidPdf:
    url: str
    bidding_starts_at: datetime
    bidding_ends_at: datetime


class BPIBuenaManoAdapter(Adapter):
    name = "bpi_buenamano"
    polite_delay_s = 3.0

    def __init__(
        self,
        *,
        bid_pdf_url: Optional[str] = None,
        bidding_starts_at: Optional[datetime] = None,
        bidding_ends_at: Optional[datetime] = None,
        user_agent: str = DEFAULT_USER_AGENT,
        supabase_client=None,
        snapshot_bucket: str = "scrape-snapshots",
        snapshot_local_dir: Optional[str] = None,
    ) -> None:
        self.bid_pdf_url = bid_pdf_url
        self.bidding_starts_at = bidding_starts_at
        self.bidding_ends_at = bidding_ends_at
        self.user_agent = user_agent
        self.supabase_client = supabase_client
        self.snapshot_bucket = snapshot_bucket
        self.snapshot_local_dir = snapshot_local_dir

    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        try:
            import httpx
            import pdfplumber
        except ImportError as exc:
            raise RuntimeError("Install httpx and pdfplumber to scrape BPI Buena Mano") from exc

        async with httpx.AsyncClient(timeout=60, follow_redirects=True, headers={"User-Agent": self.user_agent}) as client:
            discovered = await self._pdfs_to_scrape(client)
            for pdf in discovered:
                response = await client.get(pdf.url)
                response.raise_for_status()
                pdf_bytes = response.content
                snapshot_path = await save_snapshot(
                    f"bpi_buenamano/{datetime.now(timezone.utc).strftime('%Y%m%d')}/{_filename(pdf.url)}",
                    pdf_bytes,
                    supabase_client=self.supabase_client,
                    bucket=self.snapshot_bucket,
                    local_dir=self.snapshot_local_dir,
                )

                with pdfplumber.open(BytesIO(pdf_bytes)) as document:
                    for page in document.pages:
                        for table in page.extract_tables() or []:
                            for row in self.iter_rows(table):
                                listing = self.row_to_listing(
                                    row,
                                    source_url=pdf.url,
                                    bidding_starts_at=pdf.bidding_starts_at,
                                    bidding_ends_at=pdf.bidding_ends_at,
                                )
                                if listing:
                                    yield _with_snapshot_path(listing, snapshot_path)

    async def _pdfs_to_scrape(self, client) -> list[DiscoveredBidPdf]:
        if self.bid_pdf_url:
            if not self.bidding_starts_at or not self.bidding_ends_at:
                raise RuntimeError("bidding_starts_at and bidding_ends_at are required with bid_pdf_url")
            return [
                DiscoveredBidPdf(
                    url=self.bid_pdf_url,
                    bidding_starts_at=self.bidding_starts_at,
                    bidding_ends_at=self.bidding_ends_at,
                )
            ]

        response = await client.get(BUENAMANO_URL)
        response.raise_for_status()
        await save_snapshot(
            f"bpi_buenamano/{datetime.now(timezone.utc).strftime('%Y%m%d')}/index.html",
            response.content,
            supabase_client=self.supabase_client,
            bucket=self.snapshot_bucket,
            local_dir=self.snapshot_local_dir,
        )
        return discover_pdf_links_from_html(response.text, BUENAMANO_URL)

    def iter_rows(self, table: Iterable[Iterable[Optional[str]]]):
        seen_header = False
        for row in table:
            cells = [(cell or "").strip() for cell in row]
            if not seen_header:
                if any("property code" in cell.lower() for cell in cells):
                    seen_header = True
                continue
            if not any(cells):
                continue
            yield cells

    def row_to_listing(
        self,
        row: Iterable[Optional[str]],
        *,
        source_url: str,
        bidding_starts_at: Optional[datetime] = None,
        bidding_ends_at: Optional[datetime] = None,
    ) -> Optional[CanonicalListing]:
        cells = [(cell or "").strip() for cell in row]
        if len(cells) < 6:
            return None
        ref, address_raw, tag_raw, lot_area, floor_area, price_text = cells[:6]
        if not ref or not address_raw:
            return None
        price = parse_php(price_text)
        if price is None:
            return None
        title_status, occupancy = tag_to_title_and_occupancy(tag_raw)
        return CanonicalListing(
            source="bpi_buenamano",
            source_listing_id=ref,
            source_url=source_url,
            title=address_raw[:140],
            property_type=guess_property_type(address_raw),
            address_raw=address_raw,
            lot_area_sqm=to_decimal(lot_area),
            floor_area_sqm=to_decimal(floor_area),
            price_php=price,
            sale_mode="sealed_bidding",
            bidding_starts_at=bidding_starts_at or self.bidding_starts_at,
            bidding_ends_at=bidding_ends_at or self.bidding_ends_at,
            occupancy_status=occupancy,
            title_status=title_status,
            risk_tier=tag_to_risk_tier(tag_raw),
            raw_metadata={"tag_raw": tag_raw},
        )


def discover_pdf_links_from_html(html: str, base_url: str) -> list[DiscoveredBidPdf]:
    bid_range = _parse_bid_range(html)
    if not bid_range:
        return []
    starts_at, ends_at = bid_range
    pdfs: list[DiscoveredBidPdf] = []
    seen: set[str] = set()
    for href in PDF_HREF_RE.findall(html):
        absolute = urljoin(base_url, href)
        lower = absolute.lower()
        if absolute in seen or "buenamano" not in lower or "bidding" not in lower:
            continue
        seen.add(absolute)
        pdfs.append(DiscoveredBidPdf(absolute, starts_at, ends_at))
    return pdfs


def tag_to_risk_tier(tag: str):
    lower = (tag or "").lower()
    if "green" in lower:
        return "green"
    if "yellow" in lower:
        return "yellow"
    if "red" in lower:
        return "red"
    return "unknown"


def tag_to_title_and_occupancy(tag: str):
    lower = (tag or "").lower()
    title_status = "unknown"
    occupancy = "unknown"
    if "green" in lower:
        title_status = "clean"
    if "consolidat" in lower:
        title_status = "unconsolidated"
    if "court" in lower or "lis pendens" in lower or "adverse" in lower:
        title_status = "with_court_case"
    if "occupant" in lower or "occupied" in lower or "tenant" in lower or "settler" in lower:
        occupancy = "occupied"
    if "vacant" in lower:
        occupancy = "vacant"
    return title_status, occupancy


def to_decimal(value: str) -> Optional[Decimal]:
    if not value:
        return None
    cleaned = re.sub(r"[^\d.]", "", value)
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def guess_property_type(address_raw: str):
    lower = (address_raw or "").lower()
    if "condominium" in lower or "condo" in lower or "unit " in lower:
        return "condo"
    if "townhouse" in lower:
        return "townhouse"
    if "apartment" in lower:
        return "apartment"
    if "warehouse" in lower:
        return "warehouse"
    if "vacant lot" in lower or "lot only" in lower:
        return "lot_only"
    if "commercial" in lower:
        return "commercial"
    if "industrial" in lower:
        return "industrial"
    if "agricultural" in lower:
        return "agricultural"
    return "house_and_lot"


def _parse_bid_range(html: str) -> Optional[tuple[datetime, datetime]]:
    text = re.sub(r"\s+", " ", html)
    match = BID_RANGE_RE.search(text)
    if not match:
        return None
    start_date, start_time, end_date, end_time = match.groups()
    return (_parse_bid_datetime(start_date, start_time), _parse_bid_datetime(end_date, end_time))


def _parse_bid_datetime(date_text: str, time_text: str) -> datetime:
    parsed = datetime.strptime(f"{date_text} {time_text}", "%B %d, %Y %I:%M %p")
    return parsed.replace(tzinfo=PHILIPPINES_TZ)


def _filename(url: str) -> str:
    return url.rstrip("/").split("/")[-1] or "bid.pdf"


def _with_snapshot_path(listing: CanonicalListing, snapshot_path: str) -> CanonicalListing:
    return CanonicalListing(
        **{**listing.__dict__, "snapshot_path": snapshot_path}
    )
