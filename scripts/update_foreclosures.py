import json
import os

def convert():
    all_1_path = '/Users/m/propia/all-1.json'
    output_path = '/Users/m/propia/assets/data/foreclosures.json'
    
    with open(all_1_path, 'r') as f:
        data = json.load(f)
    
    features = []
    for item in data:
        # Map properties
        props = {
            "id": item.get("id"),
            "title": item.get("title"),
            "description": item.get("description"),
            "location": item.get("location"),
            "price": item.get("price_php"),
            "type": item.get("property_type", "UNKNOWN"),
            "source": item.get("bank_name", "Unknown"),
            "status": item.get("status", "AVAILABLE"),
            "lotArea": item.get("lot_area_sqm") or 0,
            "floorArea": item.get("floor_area_sqm") or 0,
            "bedrooms": 0,
            "bathrooms": 0,
            "auctionDate": "TBA",
            "image": "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?q=80&w=400"
        }
        
        # Create geometry
        geometry = None
        if item.get("lat") and item.get("lng"):
            geometry = {
                "type": "Point",
                "coordinates": [item["lng"], item["lat"]]
            }
            
        feature = {
            "type": "Feature",
            "geometry": geometry,
            "properties": props
        }
        features.append(feature)
        
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    
    with open(output_path, 'w') as f:
        json.dump(geojson, f, indent=2)
    print(f"Successfully converted {len(features)} items to GeoJSON.")

if __name__ == "__main__":
    convert()
