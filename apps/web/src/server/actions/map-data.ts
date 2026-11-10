'use server';

/**
 * Data layers for the interactive risk map, fetched on demand by the client
 * map component (so they don't bloat the deal record). Both fail-soft: a null
 * return surfaces as "layer unavailable" in the map UI.
 */

import type { GeoCollection } from '@/server/public-data/geojson';
import { fetchCrimePoints } from '@/server/public-data/crime';
import { fetchDeprivation } from '@/server/public-data/deprivation';
import { requireTenant } from '@/server/auth/tenant';
import { assertMapRequest } from '@/lib/dd-map';
import { geocodePostcode, normalisePostcode } from '@/server/public-data/geocode';

export async function getMapLocation(rawPostcode: string) {
  await requireTenant();
  if (typeof rawPostcode !== 'string' || rawPostcode.length > 12) return null;
  const postcode = normalisePostcode(rawPostcode);
  if (!/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) return null;
  return geocodePostcode(postcode);
}

export async function getCrimeHeat(
  lat: number,
  lng: number,
  radiusKm = 3,
): Promise<GeoCollection | null> {
  await requireTenant();
  assertMapRequest(lat, lng, radiusKm);
  return fetchCrimePoints(lat, lng, radiusKm);
}

export async function getDeprivation(
  lat: number,
  lng: number,
  radiusKm = 3,
): Promise<GeoCollection | null> {
  await requireTenant();
  assertMapRequest(lat, lng, radiusKm);
  return fetchDeprivation(lat, lng, radiusKm);
}
