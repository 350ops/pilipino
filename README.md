# Propia

Propia is an Expo React Native app for discovering foreclosure property opportunities in the Philippines.

## Current MVP

- Local foreclosure dataset from `assets/data/foreclosures.json`
- Buyer/investor Explore, Listings, Map, Detail, and Inquiries flows
- Searchable map tab with Philippine property markers
- Property detail pages with price, source, status, due-diligence fields, and embedded maps
- Dark/light theme support from the original template

## Getting Started

```bash
# Use Node.js v20+
npm install

# Start the Expo development server
npx expo start -c
```

## Data

The app currently ships with a local GeoJSON dataset. Refresh scripts live in `scripts/`, but live bank or Pag-IBIG aggregation is not part of this MVP.
