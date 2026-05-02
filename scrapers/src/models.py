from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional


PropertyType = Literal[
    "house_and_lot",
    "condo",
    "lot_only",
    "townhouse",
    "apartment",
    "commercial",
    "industrial",
    "agricultural",
    "warehouse",
    "other",
]
SaleMode = Literal["negotiated", "sealed_bidding", "auction"]
Occupancy = Literal["vacant", "occupied", "unknown"]
TitleStatus = Literal[
    "clean",
    "with_levy",
    "with_court_case",
    "unconsolidated",
    "annotated",
    "unknown",
]
RiskTier = Literal["green", "yellow", "red", "unknown"]
Source = Literal["bdo", "bpi_buenamano", "pagibig", "pnb", "metrobank", "other"]


PROPERTY_TYPES = {
    "house_and_lot",
    "condo",
    "lot_only",
    "townhouse",
    "apartment",
    "commercial",
    "industrial",
    "agricultural",
    "warehouse",
    "other",
}
SALE_MODES = {"negotiated", "sealed_bidding", "auction"}
OCCUPANCIES = {"vacant", "occupied", "unknown"}
TITLE_STATUSES = {
    "clean",
    "with_levy",
    "with_court_case",
    "unconsolidated",
    "annotated",
    "unknown",
}
RISK_TIERS = {"green", "yellow", "red", "unknown"}
SOURCES = {"bdo", "bpi_buenamano", "pagibig", "pnb", "metrobank", "other"}


@dataclass(frozen=True)
class CanonicalPhoto:
    url: str
    ordering: int = 0

    def __post_init__(self) -> None:
        if not self.url.startswith(("http://", "https://")):
            raise ValueError("photo url must be absolute")


@dataclass(frozen=True)
class CanonicalListing:
    source: Source
    source_listing_id: str
    source_url: Optional[str]
    title: str
    property_type: PropertyType
    address_raw: str
    price_php: Decimal
    sale_mode: SaleMode
    barangay: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    region: Optional[str] = None
    lot_area_sqm: Optional[Decimal] = None
    floor_area_sqm: Optional[Decimal] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    appraised_value_php: Optional[Decimal] = None
    bidding_starts_at: Optional[datetime] = None
    bidding_ends_at: Optional[datetime] = None
    occupancy_status: Occupancy = "unknown"
    title_status: TitleStatus = "unknown"
    risk_tier: RiskTier = "unknown"
    redemption_until: Optional[date] = None
    photos: List[CanonicalPhoto] = field(default_factory=list)
    raw_metadata: Dict[str, Any] = field(default_factory=dict)
    snapshot_path: Optional[str] = None

    def __post_init__(self) -> None:
        if self.source not in SOURCES:
            raise ValueError(f"invalid source: {self.source}")
        if not self.source_listing_id.strip():
            raise ValueError("source_listing_id is required")
        if not self.title.strip():
            raise ValueError("title is required")
        if self.property_type not in PROPERTY_TYPES:
            raise ValueError(f"invalid property_type: {self.property_type}")
        if self.sale_mode not in SALE_MODES:
            raise ValueError(f"invalid sale_mode: {self.sale_mode}")
        if self.occupancy_status not in OCCUPANCIES:
            raise ValueError(f"invalid occupancy_status: {self.occupancy_status}")
        if self.title_status not in TITLE_STATUSES:
            raise ValueError(f"invalid title_status: {self.title_status}")
        if self.risk_tier not in RISK_TIERS:
            raise ValueError(f"invalid risk_tier: {self.risk_tier}")
        if self.price_php < 0:
            raise ValueError("price_php must be non-negative")
        if self.source_url and not self.source_url.startswith(("http://", "https://")):
            raise ValueError("source_url must be absolute")
