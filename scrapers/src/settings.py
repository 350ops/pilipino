from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_USER_AGENT = "ForeclosurePHBot/0.1 (+mailto:hello@example.com)"


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    snapshot_bucket: str = "scrape-snapshots"
    user_agent: str = DEFAULT_USER_AGENT


def load_settings(require_supabase: bool = True) -> Settings:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if require_supabase and (not url or not key):
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return Settings(
        supabase_url=url,
        supabase_service_role_key=key,
        snapshot_bucket=os.environ.get("SCRAPE_SNAPSHOT_BUCKET", "scrape-snapshots"),
        user_agent=os.environ.get("SCRAPER_USER_AGENT", DEFAULT_USER_AGENT),
    )


def get_supabase(settings: Settings):
    try:
        from supabase import create_client
    except ImportError as exc:
        raise RuntimeError("Install the 'supabase' package to write scraper results") from exc
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
