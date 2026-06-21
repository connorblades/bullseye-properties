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

export async function fetchDeprivation(lat: number, lng: number): Promise<GeoCollection | null> {
  const key = `deprivation:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'deprivation', TTL.month, () =>
    failSoft('deprivation', async () => {
      const d = 0.012; // ~1.3km envelope
      const params = new URLSearchParams({
        geometry: `${lng - d},${lat - d},${lng + d},${lat + d}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'lsoa11nm,IMDDecil',
        returnGeometry: 'true',
        maxAllowableOffset: '0.0004', // simplify so the payload stays small
        f: 'geojson',
      });
      const data = await fetchJson<GeoCollection>(`${IMD_QUERY}?${params.toString()}`);
      if (!data.features || data.features.length === 0) throw new Error('no LSOA deprivation data');
      return data;
    }),
  );
}
