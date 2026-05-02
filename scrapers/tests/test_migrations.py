from pathlib import Path
import unittest


MIGRATION = Path("supabase/migrations/202605020001_foreclosure_scraper_schema.sql")


class MigrationTests(unittest.TestCase):
    def test_foreclosure_schema_contains_pipeline_contracts(self):
        sql = MIGRATION.read_text()

        required_fragments = [
            "create table if not exists public.listings",
            "constraint listings_source_listing_uk unique (source, source_listing_id)",
            "create table if not exists public.listing_price_history",
            "create table if not exists public.scrape_runs",
            "create table if not exists public.scraping_staging",
            "primary key (run_id, source, source_listing_id)",
            "create table if not exists public.geocoding_queue",
            "create or replace function public.promote_listings",
            "insert into public.listings",
            "update public.listings",
            "insert into public.listing_photos",
            "status = 'withdrawn'",
        ]

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)


if __name__ == "__main__":
    unittest.main()
