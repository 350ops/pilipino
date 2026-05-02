from __future__ import annotations

import argparse
import asyncio
import json

from scrapers.src.adapters.bdo import BDOAdapter
from scrapers.src.adapters.bpi_buenamano import BPIBuenaManoAdapter
from scrapers.src.settings import get_supabase, load_settings
from scrapers.src.staging import (
    dedupe_listings,
    finalize_run,
    serialize_listing_payload,
    start_run,
    upsert_to_staging,
)


SOURCES = ("bdo", "bpi_buenamano", "all")


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run foreclosure source scrapers")
    parser.add_argument("--source", choices=SOURCES, default="all")
    parser.add_argument("--dry-run", action="store_true", help="Validate listings without writing to Supabase")
    parser.add_argument("--snapshot-dir", default=None, help="Write raw snapshots locally")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N listings per source in dry-run mode")
    args = parser.parse_args(argv)

    settings = load_settings(require_supabase=not args.dry_run)
    supabase = None if args.dry_run else get_supabase(settings)
    adapters = list(_build_adapters(args.source, settings, supabase, args.snapshot_dir))

    for adapter in adapters:
        if args.dry_run:
            await _run_dry(adapter, args.limit)
        else:
            await _run_persisted(adapter, supabase)
    return 0


def _build_adapters(source: str, settings, supabase, snapshot_dir: str | None):
    if source in ("bdo", "all"):
        yield BDOAdapter(
            user_agent=settings.user_agent,
            supabase_client=supabase,
            snapshot_bucket=settings.snapshot_bucket,
            snapshot_local_dir=snapshot_dir,
        )
    if source in ("bpi_buenamano", "all"):
        yield BPIBuenaManoAdapter(
            user_agent=settings.user_agent,
            supabase_client=supabase,
            snapshot_bucket=settings.snapshot_bucket,
            snapshot_local_dir=snapshot_dir,
        )


async def _run_dry(adapter, limit: int) -> None:
    listings = []
    async for listing in adapter.scrape():
        listings.append(listing)
        if limit and len(listings) >= limit:
            break
    deduped = dedupe_listings(listings)
    print(
        json.dumps(
            {
                "source": adapter.name,
                "count": len(deduped),
                "sample": [serialize_listing_payload(item) for item in deduped[:3]],
            },
            indent=2,
        )
    )


async def _run_persisted(adapter, supabase) -> None:
    run_id = await start_run(supabase, adapter.name)
    count = 0
    errors = 0
    try:
        async for listing in adapter.scrape():
            try:
                await upsert_to_staging(supabase, run_id, listing)
                count += 1
            except Exception as exc:
                errors += 1
                print(f"[{adapter.name}] staging upsert error: {exc}")
        await finalize_run(supabase, run_id, status="ok" if errors == 0 else "partial", count=count, errors=errors)
        supabase.rpc("promote_listings", {"p_source": adapter.name, "p_run_id": run_id}).execute()
    except Exception:
        await finalize_run(supabase, run_id, status="failed", count=count, errors=errors)
        raise


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
