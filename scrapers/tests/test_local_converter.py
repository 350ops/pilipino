from contextlib import redirect_stdout
import json
from pathlib import Path
import tempfile
import unittest
from io import StringIO

from scripts.convert_geojson import convert_to_geojson


class LocalConverterTests(unittest.TestCase):
    def test_update_foreclosures_no_longer_uses_hard_coded_external_paths(self):
        script = Path("scripts/update_foreclosures.py").read_text()

        self.assertNotIn("/Users/m/propia", script)
        self.assertIn("convert_to_geojson", script)

    def test_convert_to_geojson_writes_app_ready_feature_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input.json"
            output = Path(tmp) / "output.json"
            source.write_text(
                json.dumps(
                    [
                        {
                            "id": "fp_1",
                            "title": "Sample Foreclosure",
                            "description": "A sample listing",
                            "location": "Taguig City",
                            "property_type": "CONDO",
                            "price_php": 1230000,
                            "bank_name": "BDO",
                            "status": "AVAILABLE",
                            "lot_area_sqm": None,
                            "floor_area_sqm": 25.5,
                            "lat": 14.55,
                            "lng": 121.05,
                        }
                    ]
                )
            )

            with redirect_stdout(StringIO()):
                convert_to_geojson(str(source), str(output))
            converted = json.loads(output.read_text())

        self.assertEqual(converted["type"], "FeatureCollection")
        self.assertEqual(converted["features"][0]["geometry"]["coordinates"], [121.05, 14.55])
        self.assertEqual(converted["features"][0]["properties"]["price"], 1230000)
        self.assertEqual(converted["features"][0]["properties"]["source"], "BDO")


if __name__ == "__main__":
    unittest.main()
