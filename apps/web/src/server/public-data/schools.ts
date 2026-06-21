/**
 * Server-only schools + Ofsted integration (supporting info).
 *
 * Queries a hosted English schools FeatureService (carries DfE school details +
 * the latest Ofsted rating) for schools around the property, returning the
 * nearest with their rating and distance. School *catchment* polygons are set
 * per local authority and aren't nationally published, so this is nearest-plus-
 * rating, not catchment membership. Cached 30 days. Fail-soft.
 */

import type { SchoolInfo } from '@/lib/deal-store';
import type { GeoCollection } from './geojson';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const SCHOOLS_QUERY =
  'https://services.arcgis.com/XSeYKQzfXnEgju9o/arcgis/rest/services/' +
  'EnglishSchools2021_2/FeatureServer/0/query';

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

type SchoolProps = {
  USER_SCHNAME?: string;
  USER_SCHOOLTYPE?: string;
  USER_OFSTEDRATING?: string;
  USER_OFSTEDLASTINSP?: string;
};

export async function fetchSchools(lat: number, lng: number): Promise<SchoolInfo[] | null> {
  const key = `schools:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'schools', TTL.month, () =>
    failSoft('schools', async () => {
      const dLat = 0.018; // ~2km
      const dLng = 0.018 / Math.cos((lat * Math.PI) / 180);
      const params = new URLSearchParams({
        geometry: `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'USER_SCHNAME,USER_SCHOOLTYPE,USER_OFSTEDRATING,USER_OFSTEDLASTINSP',
        returnGeometry: 'true',
        f: 'geojson',
      });
      const data = await fetchJson<GeoCollection>(`${SCHOOLS_QUERY}?${params.toString()}`);
      const features = data.features ?? [];
      if (features.length === 0) throw new Error('no schools found');

      const schools: SchoolInfo[] = [];
      for (const f of features) {
        const p = (f.properties ?? {}) as SchoolProps;
        const coords = f.geometry?.coordinates as [number, number] | undefined;
        if (!coords || !p.USER_SCHNAME) continue;
        schools.push({
          name: p.USER_SCHNAME,
          type: p.USER_SCHOOLTYPE ?? '',
          ...(p.USER_OFSTEDRATING ? { ofstedRating: p.USER_OFSTEDRATING } : {}),
          ...(p.USER_OFSTEDLASTINSP ? { ofstedDate: p.USER_OFSTEDLASTINSP } : {}),
          distanceMi: Math.round(haversineMi(lat, lng, coords[1], coords[0]) * 100) / 100,
        });
      }
      schools.sort((a, b) => a.distanceMi - b.distanceMi);
      return schools.slice(0, 12);
    }),
  );
}
