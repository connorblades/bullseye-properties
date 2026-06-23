/**
 * Server-only Environment Agency river-level integration (open-data expansion).
 *
 * The EA real-time flood-monitoring API (OGL, free, no key) lists monitoring
 * stations. We query level stations within ~8km of the point and return the
 * nearest few as flood context, complementing the planning flood zones already
 * in FloodInfo. Cached 30 days per postcode. Fully fail-soft.
 *
 * Docs: https://environment.data.gov.uk/flood-monitoring/doc/reference
 */

import type { RiverLevelInfo, RiverStation } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const STATIONS = 'https://environment.data.gov.uk/flood-monitoring/id/stations';

type StationsResp = {
  items?: {
    label?: string | string[];
    riverName?: string | string[];
    town?: string;
    lat?: number;
    long?: number;
  }[];
};

const first = (v?: string | string[]): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Great-circle distance in km. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function fetchRiverLevels(postcode: string, lat: number, lng: number): Promise<RiverLevelInfo | null> {
  const key = `riverLevels:${postcode}`;
  return cached(key, 'riverLevels', TTL.month, () =>
    failSoft('river-levels', async () => {
      const url = `${STATIONS}?parameter=level&lat=${lat}&long=${lng}&dist=8`;
      const data = await fetchJson<StationsResp>(url);
      const stations: RiverStation[] = (data.items ?? [])
        .filter((s) => typeof s.lat === 'number' && typeof s.long === 'number')
        .map((s) => ({
          label: first(s.label) ?? 'Monitoring station',
          riverName: first(s.riverName),
          town: s.town,
          distanceKm: Math.round(haversineKm(lat, lng, s.lat as number, s.long as number) * 10) / 10,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 4);

      if (stations.length === 0) throw new Error('no river-level stations near point');
      return { stations, source: 'Environment Agency real-time flood-monitoring' } satisfies RiverLevelInfo;
    }),
  );
}
