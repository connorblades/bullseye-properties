import type { Amenity } from './deal-store';
import type { GeoCollection } from '@/server/public-data/geojson';

export const MAP_RADII = [1, 3, 5] as const;
export type MapRadius = typeof MAP_RADII[number];
export const EMPTY_GEOJSON: GeoCollection = { type: 'FeatureCollection', features: [] };

export function validMapCentre(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 49 && lat <= 61 && lng >= -9 && lng <= 2;
}

export function assertMapRequest(lat: number, lng: number, radiusKm: number): void {
  if (!validMapCentre(lat, lng) || !MAP_RADII.some((r) => r === radiusKm)) {
    throw new Error('Choose a UK location and a 1, 3 or 5 km search radius.');
  }
}

const RAD = Math.PI / 180;
export function distanceKm(lat: number, lng: number, otherLat: number, otherLng: number): number {
  const a = Math.sin((otherLat - lat) * RAD / 2) ** 2 +
    Math.cos(lat * RAD) * Math.cos(otherLat * RAD) * Math.sin((otherLng - lng) * RAD / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Same geodesic ring is drawn in the browser and sent to the Police API. */
export function searchRing(lat: number, lng: number, radiusKm: number): [number, number][] {
  assertMapRequest(lat, lng, radiusKm);
  const angular = radiusKm / 6371;
  const points: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const bearing = i * 2 * Math.PI / 64;
    const nextLat = Math.asin(Math.sin(lat * RAD) * Math.cos(angular) +
      Math.cos(lat * RAD) * Math.sin(angular) * Math.cos(bearing));
    const nextLng = lng * RAD + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat * RAD),
      Math.cos(angular) - Math.sin(lat * RAD) * Math.sin(nextLat));
    points.push([nextLng / RAD, nextLat / RAD]);
  }
  return [...points, points[0]];
}

export function searchArea(lat: number, lng: number, radiusKm: number): GeoCollection {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [searchRing(lat, lng, radiusKm)] } }] };
}

export function amenityPins(amenities: Amenity[], lat: number, lng: number, radiusKm: number): GeoCollection {
  return { type: 'FeatureCollection', features: amenities.flatMap((a) => {
    if (a.lat == null || a.lng == null || !validMapCentre(a.lat, a.lng)) return [];
    const distance = distanceKm(lat, lng, a.lat, a.lng);
    if (distance > radiusKm) return [];
    return [{ type: 'Feature' as const, geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      properties: { name: a.name, category: a.category, distanceKm: distance.toFixed(2),
        detail: `${a.category} · ${distance.toFixed(2)} km from postcode centre (straight line)` } }];
  }) };
}

export function mapDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date not recorded';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
