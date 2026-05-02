import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHILIPPINES_REGION,
  filterForeclosures,
  findForeclosureById,
  getRegionForProperties,
  normalizeForeclosureCollection,
} from './foreclosures';

const sampleCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [120.848502, 14.87016],
      },
      properties: {
        id: 'bulacan-lot',
        title: 'Foreclosed Residential Lot in Bulacan',
        description: 'Residential lot in Bulacan',
        location: 'Plaridel, Bulacan',
        price: 2570000,
        type: 'RESIDENTIAL_LOT',
        source: 'Pag-IBIG',
        status: 'AVAILABLE',
        sale_mode: 'PUBLIC_AUCTION',
        occupancy: 'No Possession',
        lotArea: null,
        floorArea: null,
      },
    },
    {
      type: 'Feature',
      geometry: null,
      properties: {
        id: 'cebu-house',
        title: 'Foreclosed House in Cebu',
        description: 'House and lot in Cebu',
        location: 'Cebu City, Cebu',
        price_php: 6200000,
        property_type: 'HOUSE_AND_LOT',
        bank_name: 'BDO',
        status: 'AVAILABLE',
        lot_area_sqm: 120,
        floor_area_sqm: 80,
      },
    },
  ],
};

test('normalizes GeoJSON foreclosure features into app properties', () => {
  const properties = normalizeForeclosureCollection(sampleCollection);

  assert.equal(properties.length, 2);
  assert.equal(properties[0].id, 'bulacan-lot');
  assert.equal(properties[0].price, 2570000);
  assert.equal(properties[0].saleMode, 'PUBLIC_AUCTION');
  assert.equal(properties[0].occupancy, 'No Possession');
  assert.deepEqual(properties[0].coordinates, {
    latitude: 14.87016,
    longitude: 120.848502,
  });
  assert.equal(properties[0].hasValidCoordinates, true);
  assert.equal(properties[1].type, 'HOUSE_AND_LOT');
  assert.equal(properties[1].source, 'BDO');
  assert.equal(properties[1].lotArea, 120);
  assert.equal(properties[1].hasValidCoordinates, false);
});

test('finds foreclosure properties by id', () => {
  const properties = normalizeForeclosureCollection(sampleCollection);

  assert.equal(findForeclosureById(properties, 'cebu-house')?.title, 'Foreclosed House in Cebu');
  assert.equal(findForeclosureById(properties, 'missing'), undefined);
});

test('filters foreclosures by case-insensitive location query and coordinate availability', () => {
  const properties = normalizeForeclosureCollection(sampleCollection);

  assert.deepEqual(
    filterForeclosures(properties, { query: 'bulacan', onlyMapped: true }).map((property) => property.id),
    ['bulacan-lot']
  );
  assert.deepEqual(
    filterForeclosures(properties, { query: 'cebu', onlyMapped: true }).map((property) => property.id),
    []
  );
});

test('builds a focused map region for mapped properties and falls back to the Philippines', () => {
  const properties = normalizeForeclosureCollection(sampleCollection);

  assert.deepEqual(getRegionForProperties([]), PHILIPPINES_REGION);
  assert.deepEqual(getRegionForProperties([properties[1]]), PHILIPPINES_REGION);

  const region = getRegionForProperties([properties[0]]);
  assert.equal(region.latitude, 14.87016);
  assert.equal(region.longitude, 120.848502);
  assert.equal(region.latitudeDelta, 0.25);
  assert.equal(region.longitudeDelta, 0.25);
});
