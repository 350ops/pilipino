import json


DEFAULT_IMAGE = "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?q=80&w=400"


def convert_to_geojson(input_file, output_file):
    with open(input_file, "r") as f:
        data = json.load(f)

    features = []
    for item in data:
        props = {
            "id": item.get("id"),
            "title": item.get("title"),
            "description": item.get("description"),
            "location": item.get("location"),
            "price": item.get("price_php"),
            "type": item.get("property_type"),
            "source": item.get("bank_name"),
            "status": item.get("status"),
            "lotArea": item.get("lot_area_sqm", 0) or 0,
            "floorArea": item.get("floor_area_sqm", 0) or 0,
            "bedrooms": item.get("bedrooms", 0) or 0,
            "bathrooms": item.get("bathrooms", 0) or 0,
            "auctionDate": item.get("auction_date") or "TBA",
            "image": item.get("image") or DEFAULT_IMAGE,
        }

        lat = item.get("lat")
        lng = item.get("lng")
        geometry = (
            {
                "type": "Point",
                "coordinates": [float(lng), float(lat)],
            }
            if lat is not None and lng is not None
            else None
        )

        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": props,
            }
        )

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    with open(output_file, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"Successfully converted {len(features)} items to {output_file}")


if __name__ == "__main__":
    convert_to_geojson("assets/data/fore.json", "assets/data/foreclosures.json")
