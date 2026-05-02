from __future__ import annotations

from pathlib import Path
from typing import Optional


async def save_snapshot(
    path: str,
    content: bytes,
    *,
    supabase_client=None,
    bucket: str = "scrape-snapshots",
    local_dir: Optional[str] = None,
) -> str:
    if local_dir:
        target = Path(local_dir) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return str(target)

    if supabase_client is None:
        return path

    supabase_client.storage.from_(bucket).upload(
        path,
        content,
        {"content-type": _content_type(path), "x-upsert": "false"},
    )
    return path


def _content_type(path: str) -> str:
    lower = path.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith(".json"):
        return "application/json"
    return "text/html; charset=utf-8"
