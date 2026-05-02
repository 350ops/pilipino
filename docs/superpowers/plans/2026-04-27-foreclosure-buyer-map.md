# Foreclosure Buyer Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the visible buyer journey into a local-dataset foreclosure discovery app and add a searchable map tab with pressable property markers.

**Architecture:** Add a pure foreclosure utility module for normalization, lookup, filtering, and map-region calculation. Reuse existing Expo Router screens, wiring cards and markers to property ids and replacing hard-coded detail/map content with local dataset data.

**Tech Stack:** Expo Router, React Native, TypeScript, NativeWind, `react-native-maps`, Node built-in test runner for pure utility checks.

---

### Task 1: Foreclosure Utility Layer

**Files:**
- Create: `lib/foreclosures.ts`
- Create: `lib/foreclosures.test.ts`
- Modify: `app/hooks/useForeclosures.ts`

- [ ] Write tests for normalizing GeoJSON features, finding by id, filtering by location, and building a map region from coordinates.
- [ ] Verify the tests fail before the utility exists by compiling the test with `tsc`.
- [ ] Implement the utility module.
- [ ] Update `useForeclosures` to use the utility module and expose `getPropertyById`, `filterProperties`, and `getRegionForProperties`.
- [ ] Re-run utility tests and TypeScript.

### Task 2: Detail Screen Data and Embedded Map

**Files:**
- Modify: `app/screens/product-detail.tsx`

- [ ] Read the `id` query param with `useLocalSearchParams`.
- [ ] Render the selected local foreclosure property.
- [ ] Replace the static Google map image with `MapView` and `Marker`.
- [ ] Add missing/not-found and no-coordinate states.
- [ ] Wire share and inquiry text to the selected property.

### Task 3: Navigation to Property Details

**Files:**
- Modify: `app/(tabs)/(home)/index.tsx`
- Modify: `app/(tabs)/listings.tsx`
- Modify: `app/screens/map.tsx`

- [ ] Change card/list/map navigation to include `?id=<propertyId>`.
- [ ] Keep all property labels in PHP and foreclosure terminology.
- [ ] Ensure map markers are pressable and route to detail.

### Task 4: Searchable Map Tab

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/screens/map.tsx`

- [ ] Replace the Watchlist tab with a Map tab.
- [ ] Add a location search input to the map screen.
- [ ] On submit, filter by location and zoom to matching mapped properties.
- [ ] Show clear result count and empty states.
- [ ] Preserve the map bottom sheet list with matching properties.

### Task 5: Buyer/Investor Copy Cleanup

**Files:**
- Modify: `app/(tabs)/trips.tsx`
- Modify: `app/screens/filters.tsx`
- Modify: `README.md`

- [ ] Rename visible trips copy to inquiries.
- [ ] Replace booking filters with foreclosure filters.
- [ ] Update README to describe the foreclosure buyer/investor app.

### Task 6: Verification

**Files:**
- No new files.

- [ ] Run utility tests.
- [ ] Run `npx tsc --noEmit`.
- [ ] Start Expo and smoke-test the buyer flow in the simulator or browser target available in the environment.
