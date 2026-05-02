export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface ForeclosureCoordinates {
  latitude: number;
  longitude: number;
}

export interface ForeclosureProperty {
  id: string;
  title: string;
  description: string;
  location: string;
  price: number;
  lotArea: number;
  floorArea: number;
  bedrooms: number;
  bathrooms: number;
  type: string;
  source: string;
  status: string;
  saleMode: string;
  occupancy: string;
  auctionDate: string;
  image: string;
  coordinates: ForeclosureCoordinates;
  hasValidCoordinates: boolean;
}

export interface ForeclosureFilters {
  query?: string;
  source?: string;
  type?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
  onlyMapped?: boolean;
}

interface GeoJsonFeature {
  geometry?: {
    coordinates?: unknown[];
  } | null;
  properties?: Record<string, unknown>;
}

export const PHILIPPINES_REGION: MapRegion = {
  latitude: 12.8797,
  longitude: 121.774,
  latitudeDelta: 15,
  longitudeDelta: 10,
};

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?q=80&w=400';
const UNKNOWN = 'Unavailable';

const asString = (value: unknown, fallback = UNKNOWN) => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
};

const asNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const hasUsableCoordinate = (latitude: number, longitude: number) => {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

export const normalizePropertyType = (type: string) => {
  return type
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const formatArea = (area: number) => {
  return area > 0 ? `${area.toLocaleString('en-PH')} sqm` : 'Unavailable';
};

export const normalizeForeclosureFeature = (feature: GeoJsonFeature): ForeclosureProperty => {
  const properties = feature.properties ?? {};
  const coordinates = feature.geometry?.coordinates;
  const longitude = Array.isArray(coordinates) ? asNumber(coordinates[0], Number.NaN) : Number.NaN;
  const latitude = Array.isArray(coordinates) ? asNumber(coordinates[1], Number.NaN) : Number.NaN;
  const hasValidCoordinates = hasUsableCoordinate(latitude, longitude);

  return {
    id: asString(properties.id, `property-${Math.random().toString(36).slice(2)}`),
    title: asString(properties.title, 'Foreclosed Property'),
    description: asString(properties.description, ''),
    location: asString(properties.location, UNKNOWN),
    price: asNumber(properties.price ?? properties.price_php),
    lotArea: asNumber(properties.lotArea ?? properties.lot_area_sqm),
    floorArea: asNumber(properties.floorArea ?? properties.floor_area_sqm),
    bedrooms: asNumber(properties.bedrooms),
    bathrooms: asNumber(properties.bathrooms),
    type: asString(properties.type ?? properties.property_type, UNKNOWN),
    source: asString(properties.source ?? properties.bank_name, UNKNOWN),
    status: asString(properties.status, UNKNOWN),
    saleMode: asString(properties.saleMode ?? properties.sale_mode, UNKNOWN),
    occupancy: asString(properties.occupancy, UNKNOWN),
    auctionDate: asString(properties.auctionDate ?? properties.auction_date, 'TBA'),
    image: asString(properties.image, DEFAULT_IMAGE),
    coordinates: {
      latitude: hasValidCoordinates ? latitude : PHILIPPINES_REGION.latitude,
      longitude: hasValidCoordinates ? longitude : PHILIPPINES_REGION.longitude,
    },
    hasValidCoordinates,
  };
};

export const normalizeForeclosureCollection = (input: unknown): ForeclosureProperty[] => {
  if (Array.isArray(input)) {
    return input.map((item) =>
      normalizeForeclosureFeature({
        geometry:
          typeof item === 'object' && item && 'lat' in item && 'lng' in item
            ? { coordinates: [(item as any).lng, (item as any).lat] }
            : null,
        properties: item as Record<string, unknown>,
      })
    );
  }

  const features =
    typeof input === 'object' && input && 'features' in input && Array.isArray((input as any).features)
      ? ((input as any).features as GeoJsonFeature[])
      : [];

  return features.map(normalizeForeclosureFeature);
};

export const findForeclosureById = (properties: ForeclosureProperty[], id?: string | string[]) => {
  const propertyId = Array.isArray(id) ? id[0] : id;
  if (!propertyId) {
    return undefined;
  }

  return properties.find((property) => property.id === propertyId);
};

export const filterForeclosures = (
  properties: ForeclosureProperty[],
  filters: ForeclosureFilters
): ForeclosureProperty[] => {
  const query = filters.query?.trim().toLowerCase();

  return properties.filter((property) => {
    if (filters.onlyMapped && !property.hasValidCoordinates) {
      return false;
    }
    if (filters.source && filters.source !== 'All' && property.source !== filters.source) {
      return false;
    }
    if (filters.type && filters.type !== 'All' && property.type !== filters.type) {
      return false;
    }
    if (filters.status && filters.status !== 'All' && property.status !== filters.status) {
      return false;
    }
    if (typeof filters.minPrice === 'number' && property.price < filters.minPrice) {
      return false;
    }
    if (typeof filters.maxPrice === 'number' && property.price > filters.maxPrice) {
      return false;
    }
    if (query) {
      const haystack = `${property.title} ${property.description} ${property.location} ${property.source} ${property.type}`.toLowerCase();
      return haystack.includes(query);
    }

    return true;
  });
};

export const getRegionForProperties = (properties: ForeclosureProperty[]): MapRegion => {
  const mapped = properties.filter((property) => property.hasValidCoordinates);
  if (mapped.length === 0) {
    return PHILIPPINES_REGION;
  }

  if (mapped.length === 1) {
    return {
      latitude: mapped[0].coordinates.latitude,
      longitude: mapped[0].coordinates.longitude,
      latitudeDelta: 0.25,
      longitudeDelta: 0.25,
    };
  }

  const latitudes = mapped.map((property) => property.coordinates.latitude);
  const longitudes = mapped.map((property) => property.coordinates.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.6, 0.25),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.6, 0.25),
  };
};

export const formatPrice = (price: number) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(price);
};
