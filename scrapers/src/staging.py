from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable
from uuid import UUID

from scrapers.src.models import CanonicalListing


def serialize_listing_payload(listing: CanonicalListing) -> Dict[str, Any]:
    return _serialize(asdict(listing))


def _serialize(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    return value


async def start_run(supabase_client, source: str) -> str:
    result = (
        supabase_client.table("scrape_runs")
        .insert({"source": source, "status": "running"})
        .execute()
    )
    return result.data[0]["id"]


async def finalize_run(supabase_client, run_id: str, *, status: str, count: int, errors: int) -> None:
    (
        supabase_client.table("scrape_runs")
        .update({"status": status, "count": count, "errors": errors, "finished_at": "now()"})
        .eq("id", run_id)
        .execute()
    )


async def upsert_to_staging(supabase_client, run_id: str, listing: CanonicalListing) -> None:
    payload = serialize_listing_payload(listing)
    (
        supabase_client.table("scraping_staging")
        .upsert(
            {
                "run_id": str(run_id),
                "source": listing.source,
                "source_listing_id": listing.source_listing_id,
                "payload": payload,
            },
            on_conflict="run_id,source,source_listing_id",
        )
        .execute()
    )


def dedupe_listings(listings: Iterable[CanonicalListing]) -> list[CanonicalListing]:
    seen: set[tuple[str, str]] = set()
    deduped: list[CanonicalListing] = []
    for listing in listings:
        key = (listing.source, listing.source_listing_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(listing)
    return deduped
