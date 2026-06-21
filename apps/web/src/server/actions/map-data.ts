'use server';

/**
 * Data layers for the interactive risk map, fetched on demand by the client
 * map component (so they don't bloat the deal record). Both fail-soft: a null
 * return surfaces as "layer unavailable" in the map UI.
 */

import type { GeoCollection } from '@/server/public-data/geojson';
import { fetchCrimePoints } from '@/server/public-data/crime';
import { fetchDeprivation } from '@/server/public-data/deprivation';

export async function getCrimeHeat(lat: number, lng: number): Promise<GeoCollection | null> {
  return fetchCrimePoints(lat, lng);
}

export async function getDeprivation(lat: number, lng: number): Promise<GeoCollection | null> {
  return fetchDeprivation(lat, lng);
}
