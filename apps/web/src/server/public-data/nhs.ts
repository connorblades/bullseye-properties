/**
 * Server-only NHS facilities integration (supporting info).
 *
 * Nearest GP surgeries and hospitals to the property, as first-class data
 * (name, type, distance in miles, address). Two free hosted ArcGIS
 * FeatureServers are queried by an envelope around the property and ranked by
 * straight-line (haversine) distance, mirroring schools.ts:
 *   - GP practices: NHS Digital "AllActPrac" national master (main + branch
 *     surgeries; GP locations are stable, so this is fine for DD).
 *   - Hospitals: "Hospitals England" (NHS + independent sites, from NHS ODS).
 * No API key, no signup. Cached 30 days. Fully fail-soft: if a source is down
 * or returns nothing, that list is empty; only when BOTH are empty do we
 * fail-soft to null.
 */

import type { NhsInfo, NhsFacility } from '@/lib/deal-store';
import type { GeoCollection } from './geojson';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const GP_QUERY =
  'https://services8.arcgis.com/Xx89tRO8Kswtjlry/arcgis/rest/services/' +
  'AllActPrac_Master_202208_CCGn_view/FeatureServer/0/query';
const HOSPITALS_QUERY =
  'https://services5.arcgis.com/1ZHcUS1lwPTg4ms0/arcgis/rest/services/' +
  'Hospitals_England/FeatureServer/0/query';

const GP_HALF_DEG = 0.036; // ~4km half-envelope (GP practices are dense)
const HOSP_HALF_DEG = 0.09; // ~10km half-envelope (hospitals are sparse)
const GP_KEEP = 5;
const HOSP_KEEP = 4;

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

function envelope(lat: number, lng: number, halfDeg: number): string {
  const dLat = halfDeg;
  const dLng = halfDeg / Math.cos((lat * Math.PI) / 180);
  return `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
}

function tidy(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

type GpProps = { GPPRACN?: string; ADDRESS?: string; PCDS?: string; MainBran?: string };
type HospProps = {
  Organisa03?: string;
  Sector?: string;
  SubType?: string;
  Address1?: string;
  City?: string;
  Postcode?: string;
};

/** Query one FeatureServer envelope and map each feature to an NhsFacility. */
async function queryLayer(
  label: string,
  url: string,
  lat: number,
  lng: number,
  halfDeg: number,
  outFields: string,
  keep: number,
  toFacility: (p: Record<string, unknown>) => { name: string; type: string; address?: string } | null,
): Promise<NhsFacility[]> {
  const list = await failSoft(label, async () => {
    const params = new URLSearchParams({
      geometry: envelope(lat, lng, halfDeg),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields,
      returnGeometry: 'true',
      f: 'geojson',
    });
    const data = await fetchJson<GeoCollection>(`${url}?${params.toString()}`);
    const features = data.features ?? [];
    const out: NhsFacility[] = [];
    for (const f of features) {
      const coords = f.geometry?.coordinates as [number, number] | undefined;
      if (!coords) continue;
      const mapped = toFacility((f.properties ?? {}) as Record<string, unknown>);
      if (!mapped) continue;
      out.push({
        name: mapped.name,
        type: mapped.type,
        ...(mapped.address ? { address: mapped.address } : {}),
        distanceMi: Math.round(haversineMi(lat, lng, coords[1], coords[0]) * 100) / 100,
      });
    }
    out.sort((a, b) => a.distanceMi - b.distanceMi);
    return out.slice(0, keep);
  });
  return list ?? [];
}

export async function fetchNhs(
  _postcode: string,
  lat: number,
  lng: number,
): Promise<NhsInfo | null> {
  const key = `nhs:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'nhs', TTL.month, () =>
    failSoft('nhs', async () => {
      const [gpSurgeries, hospitals] = await Promise.all([
        queryLayer(
          'nhs-gp',
          GP_QUERY,
          lat,
          lng,
          GP_HALF_DEG,
          'GPPRACN,ADDRESS,PCDS,MainBran',
          GP_KEEP,
          (raw) => {
            const p = raw as GpProps;
            const name = tidy(p.GPPRACN);
            if (!name) return null;
            const branch = tidy(p.MainBran).toLowerCase() === 'branch';
            const address = [tidy(p.ADDRESS), tidy(p.PCDS)].filter(Boolean).join(', ');
            return {
              name,
              type: branch ? 'GP surgery (branch)' : 'GP surgery',
              ...(address ? { address } : {}),
            };
          },
        ),
        queryLayer(
          'nhs-hospitals',
          HOSPITALS_QUERY,
          lat,
          lng,
          HOSP_HALF_DEG,
          'Organisa03,Sector,SubType,Address1,City,Postcode',
          HOSP_KEEP,
          (raw) => {
            const p = raw as HospProps;
            const name = tidy(p.Organisa03);
            if (!name) return null;
            const sector = tidy(p.Sector);
            const type = sector.startsWith('Independent')
              ? 'Independent hospital'
              : sector.startsWith('NHS')
                ? 'NHS hospital'
                : 'Hospital';
            const address = [tidy(p.Address1), tidy(p.City), tidy(p.Postcode)]
              .filter(Boolean)
              .join(', ');
            return { name, type, ...(address ? { address } : {}) };
          },
        ),
      ]);

      if (gpSurgeries.length === 0 && hospitals.length === 0) {
        throw new Error('no NHS facilities found');
      }
      return { gpSurgeries, hospitals } satisfies NhsInfo;
    }),
  );
}
