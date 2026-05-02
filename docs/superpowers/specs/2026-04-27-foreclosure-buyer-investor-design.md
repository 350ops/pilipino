# Foreclosure Buyer/Investor Design

## Goal

Convert the existing Airbnb-style Expo template into a buyer/investor foreclosure discovery app for Philippine properties, using the local foreclosure dataset already bundled in the project.

## Scope

This pass keeps listing data local in `assets/data/foreclosures.json`. It does not add live scraping, a backend, authentication, payments, or persistent saved searches.

The visible buyer journey should be converted first:

- Explore surfaces foreclosure inventory and investor-oriented discovery sections.
- Listings shows the complete local inventory with foreclosure-specific filters.
- The map experience becomes a primary tab, replacing the wishlist tab.
- Property detail renders the selected real property instead of hard-coded sample data.
- Property detail shows an embedded map for listings with coordinates.
- Search and filters use property criteria such as location, price, source, type, status, area, and coordinate availability.
- Former wishlist/favorites language becomes map or watchlist language where visible in the tab bar.
- Former trips language becomes inquiries where visible in the tab bar.

## Data Model

The app should normalize each GeoJSON feature into a typed `ForeclosureProperty` object with:

- `id`
- `title`
- `description`
- `location`
- `price`
- `lotArea`
- `floorArea`
- `bedrooms`
- `bathrooms`
- `type`
- `source`
- `status`
- `saleMode`
- `occupancy`
- `auctionDate`
- `image`
- `coordinates`
- `hasValidCoordinates`

Missing source fields should be shown as unavailable rather than replaced with fake property facts.

## Navigation

Cards and map markers must navigate to `/screens/product-detail?id=<propertyId>`. The detail screen must read the id, locate the matching local property, and show a clear empty state if the id is missing or not found.

The consumer tab currently labeled Watchlist should become a Map tab. It should route to a map screen that supports searching by location text, zooming to a matching area, and showing matching properties as markers. Pressing a marker should navigate to the matching property detail.

## Map Search

The map screen should include a search input. When the user types a location and submits:

- Filter properties whose `location` includes the search text, case-insensitive.
- If filtered properties with coordinates exist, zoom the map to fit or center those coordinates.
- If matching properties have no coordinates, show an explanatory empty state for the map markers.
- If no properties match, show an empty state while keeping the Philippines region visible.

## Detail Map

The detail screen currently uses a Google static map URL with a placeholder API key. Replace that with `react-native-maps`. If the selected property has coordinates, show a noninteractive embedded map with a marker. If not, show a concise "Map unavailable" state.

## Error Handling

The app should not crash when data is incomplete. It should handle:

- Missing property id.
- Unknown property id.
- Missing coordinates.
- Empty filter or search results.
- Null or zero area fields.
- Missing sale mode, occupancy, or status.

## Verification

Verification should include:

- Unit coverage for local foreclosure utility behavior.
- `npx tsc --noEmit`.
- Manual smoke test of Explore, Listings, Map tab search, marker navigation, and Property Detail embedded map.
