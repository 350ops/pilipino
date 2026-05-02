import argparse

from scripts.convert_geojson import convert_to_geojson


def main():
    parser = argparse.ArgumentParser(
        description="Convert a local foreclosure JSON fixture into app-ready GeoJSON."
    )
    parser.add_argument("--input", default="assets/data/fore.json")
    parser.add_argument("--output", default="assets/data/foreclosures.json")
    args = parser.parse_args()

    convert_to_geojson(args.input, args.output)


if __name__ == "__main__":
    main()
