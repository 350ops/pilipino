import { useState, useEffect } from 'react';
import foreclosuresGeoJSON from '@/assets/data/foreclosures.json';
import {
  filterForeclosures,
  findForeclosureById,
  formatPrice,
  getRegionForProperties,
  normalizeForeclosureCollection,
  type ForeclosureFilters,
  type ForeclosureProperty,
} from '@/lib/foreclosures';

export type { ForeclosureFilters, ForeclosureProperty };

export const useForeclosures = () => {
  const [properties, setProperties] = useState<ForeclosureProperty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProperties(normalizeForeclosureCollection(foreclosuresGeoJSON));
      setLoading(false);
    }, 150);

    return () => clearTimeout(timer);
  }, []);

  const getPropertyById = (id?: string | string[]) => findForeclosureById(properties, id);

  return {
    properties,
    loading,
    formatPrice,
    getPropertyById,
    filterProperties: (filters: ForeclosureFilters) => filterForeclosures(properties, filters),
    getRegionForProperties,
  };
};
