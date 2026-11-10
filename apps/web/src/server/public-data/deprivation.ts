/**
 * Server-only deprivation polygons for the interactive choropleth.
 *
 * Queries the hosted IMD 2019 LSOA FeatureServer for the LSOAs around the
 * property and returns simplified polygons + decile as GeoJSON. The map shades
 * them green (least deprived) -> amber -> red (most deprived). Cached 30 days.
 * Fail-soft.
 */

import type { GeoCollection } from './geojson';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const IMD_QUERY =
  'https://services-eu1.arcgis.com/EbKcOS6EXZroSyoi/arcgis/rest/services/' +
  'Lower_Super_Output_Area_(LSOA)_IMD2019_(WGS84)/FeatureServer/0/query';

export async function fetchDeprivation(
  lat: number,
  lng: number,
  radiusKm = 3,
): Promise<GeoCollection | null> {
  const key = `deprivation:v3:${lat},${lng}:${radiusKm}`;
  return cached(key, 'deprivation', TTL.month, () =>
    failSoft('deprivation', async () => {
      const dLat = radiusKm / 111;
      const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
      // Simplify more at larger radii so the payload stays small.
      const offset = Math.max(0.0004, 0.0004 * radiusKm);
      const params = new URLSearchParams({
        geometry: `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'lsoa11nm,IMDDecil',
        returnGeometry: 'true',
        maxAllowableOffset: String(offset),
        f: 'geojson',
      });
      const data = await fetchJson<GeoCollection & { exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } }>(`${IMD_QUERY}?${params.toString()}`);
      if (!Array.isArray(data.features) || data.exceededTransferLimit || data.properties?.exceededTransferLimit) {
        throw new Error('incomplete LSOA deprivation response');
      }
      return { type: 'FeatureCollection', features: data.features, period: '2019', retrievedAt: new Date().toISOString() };
    }),
  );
}
