from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

from scrapers.src.models import CanonicalListing


class Adapter(ABC):
    name: str
    polite_delay_s: float = 2.0

    @abstractmethod
    async def scrape(self) -> AsyncIterator[CanonicalListing]:
        ...
