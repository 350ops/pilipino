from datetime import datetime, timezone
from decimal import Decimal
import unittest

from scrapers.src.adapters.bdo import (
    extract_property_code,
    parse_area_sqm,
    parse_bdo_card_text,
    parse_php,
)
from scrapers.src.adapters.bpi_buenamano import (
    BPIBuenaManoAdapter,
    discover_pdf_links_from_html,
    tag_to_risk_tier,
    tag_to_title_and_occupancy,
)
from scrapers.src.models import CanonicalListing
from scrapers.src.staging import serialize_listing_payload


class ParserTests(unittest.TestCase):
    def test_parse_php_handles_currency_labels_commas_and_decimals(self):
        self.assertEqual(parse_php("PHP 3,279,600.00"), Decimal("3279600.00"))
        self.assertEqual(parse_php("₱ 1,130,000"), Decimal("1130000"))
        self.assertIsNone(parse_php("Price on request"))

    def test_bdo_extracts_stable_property_code_from_detail_url(self):
        self.assertEqual(
            extract_property_code(
                "/personal/assets-for-sale/real-estate/details-page?propertyCode=R-2024002598"
            ),
            "R-2024002598",
        )
        self.assertIsNone(extract_property_code("/personal/assets-for-sale/real-estate"))

    def test_bdo_card_text_maps_visible_listing_fields(self):
        listing = parse_bdo_card_text(
            text="\n".join(
                [
                    "Sale",
                    "Grace Residences in Taguig City",
                    "Condominium Unit",
                    "Residential",
                    "PHP 3,279,600.00",
                    "27.33 sqm. Floor Area",
                    "0.0 sqm. Lot Area",
                ]
            ),
            source_url="https://www.bdo.com.ph/personal/assets-for-sale/real-estate/details-page?propertyCode=R-2024002598",
        )

        self.assertIsNotNone(listing)
        assert listing is not None
        self.assertEqual(listing.source, "bdo")
        self.assertEqual(listing.source_listing_id, "R-2024002598")
        self.assertEqual(listing.title, "Grace Residences in Taguig City")
        self.assertEqual(listing.property_type, "condo")
        self.assertEqual(listing.price_php, Decimal("3279600.00"))
        self.assertEqual(listing.floor_area_sqm, Decimal("27.33"))
        self.assertEqual(listing.lot_area_sqm, Decimal("0.0"))
        self.assertEqual(listing.sale_mode, "negotiated")

    def test_parse_area_sqm_handles_visible_bdo_area_labels(self):
        self.assertEqual(parse_area_sqm("27.33 sqm. Floor Area"), Decimal("27.33"))
        self.assertEqual(parse_area_sqm("1,250 sqm Lot Area"), Decimal("1250"))
        self.assertIsNone(parse_area_sqm("Floor Area unavailable"))

    def test_bpi_tag_mapping_preserves_risk_and_status_meaning(self):
        self.assertEqual(tag_to_risk_tier("GREEN TAG - clean title"), "green")
        self.assertEqual(tag_to_risk_tier("Yellow tag - consolidation ongoing"), "yellow")
        self.assertEqual(tag_to_risk_tier("RED TAG - with court case"), "red")
        self.assertEqual(tag_to_risk_tier("No tag shown"), "unknown")

        self.assertEqual(tag_to_title_and_occupancy("Green tag, vacant"), ("clean", "vacant"))
        self.assertEqual(
            tag_to_title_and_occupancy("Yellow tag, consolidation in process, with occupant"),
            ("unconsolidated", "occupied"),
        )
        self.assertEqual(
            tag_to_title_and_occupancy("Red tag, lis pendens / adverse claim"),
            ("with_court_case", "unknown"),
        )

    def test_bpi_row_maps_to_canonical_listing(self):
        adapter = BPIBuenaManoAdapter(
            bidding_starts_at=datetime(2026, 5, 4, 9, tzinfo=timezone.utc),
            bidding_ends_at=datetime(2026, 5, 27, 9, tzinfo=timezone.utc),
        )

        listing = adapter.row_to_listing(
            [
                "0705-BO-026",
                "Prime commercial lot in Cebu City",
                "Red tag - with court case and occupant",
                "1,000.50",
                "",
                "PHP 25,000,000.00",
                "Officer",
            ],
            source_url="https://www.bpi.com.ph/content/dam/buenamano/listings/sample.pdf",
        )

        self.assertIsNotNone(listing)
        assert listing is not None
        self.assertEqual(listing.source, "bpi_buenamano")
        self.assertEqual(listing.source_listing_id, "0705-BO-026")
        self.assertEqual(listing.property_type, "commercial")
        self.assertEqual(listing.lot_area_sqm, Decimal("1000.50"))
        self.assertEqual(listing.price_php, Decimal("25000000.00"))
        self.assertEqual(listing.risk_tier, "red")
        self.assertEqual(listing.title_status, "with_court_case")
        self.assertEqual(listing.occupancy_status, "occupied")
        self.assertEqual(listing.sale_mode, "sealed_bidding")

    def test_bpi_row_accepts_discovered_bid_dates(self):
        adapter = BPIBuenaManoAdapter()
        starts_at = datetime(2026, 5, 4, 9, tzinfo=timezone.utc)
        ends_at = datetime(2026, 5, 27, 9, tzinfo=timezone.utc)

        listing = adapter.row_to_listing(
            ["BM-1", "Vacant lot in Bulacan", "Green tag", "100", "", "PHP 1,000,000"],
            source_url="https://www.bpi.com.ph/list.pdf",
            bidding_starts_at=starts_at,
            bidding_ends_at=ends_at,
        )

        self.assertIsNotNone(listing)
        assert listing is not None
        self.assertEqual(listing.bidding_starts_at, starts_at)
        self.assertEqual(listing.bidding_ends_at, ends_at)

    def test_bpi_discovers_pdf_links_and_bid_dates_from_page_html(self):
        html = """
        <a href="/content/dam/buenamano/listings/properties-for-sealed-bidding/for-sealed-bidding-may-2026.pdf">
          View Properties for Sealed Bidding
        </a>
        <p>Start of bidding: May 4, 2026 at 9:00 AM to May 27, 2026 at 9:00 AM</p>
        """

        discovered = discover_pdf_links_from_html(html, "https://www.bpi.com.ph/group/buenamano")

        self.assertEqual(len(discovered), 1)
        self.assertEqual(
            discovered[0].url,
            "https://www.bpi.com.ph/content/dam/buenamano/listings/properties-for-sealed-bidding/for-sealed-bidding-may-2026.pdf",
        )
        self.assertEqual(discovered[0].bidding_starts_at.month, 5)
        self.assertEqual(discovered[0].bidding_ends_at.day, 27)

    def test_listing_payload_serializes_decimal_and_datetime_for_staging(self):
        listing = CanonicalListing(
            source="bdo",
            source_listing_id="R-1",
            source_url="https://www.bdo.com.ph/details?propertyCode=R-1",
            title="Sample",
            property_type="condo",
            address_raw="Taguig City",
            price_php=Decimal("123.45"),
            sale_mode="negotiated",
            bidding_ends_at=datetime(2026, 5, 27, 9, tzinfo=timezone.utc),
            raw_metadata={"seen": True},
        )

        payload = serialize_listing_payload(listing)

        self.assertEqual(payload["price_php"], "123.45")
        self.assertEqual(payload["bidding_ends_at"], "2026-05-27T09:00:00+00:00")
        self.assertEqual(payload["risk_tier"], "unknown")


if __name__ == "__main__":
    unittest.main()
