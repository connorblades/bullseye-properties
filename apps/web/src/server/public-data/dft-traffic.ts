/**
 * Server-only DfT Road Traffic Statistics integration (open-data expansion).
 *
 * The DfT roadtraffic API (roadtraffic.dft.gov.uk/api, free, OGL, no key) exposes
 * count points with an annual average daily flow (AADF). It has no spatial/near
 * query, so we scope by local authority (a few hundred points) and pick the
 * nearest by great-circle distance:
 *   1. Resolve the DfT local authority. DfT keys on county / unitary / metropolitan
 *      / London GSS codes (E06/E10/E08/E09/S12/W06) - NOT two-tier districts (E07).
 *      We match the orchestrator's districtCode against the LA list; if it misses
 *      (a two-tier district), we reverse-geocode the point via postcodes.io - the
 *      platform's existing geocoder - to get the parent county code and match that.
 *   2. Pull that LA's count points and find the nearest to the property.
 *   3. Pull that count point's AADF-by-direction for its latest year and sum the
 *      directions to an all-motor-vehicles total (+ HGV component).
 *
 * Cached 30 days per (lat,lng). Fully fail-soft. Road-safety (STATS19 collisions)
 * is NOT available here - it is bulk CSV only.
 *
 * Docs: https://roadtraffic.dft.gov.uk/api
 */

import type { TrafficInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const DFT = 'https://roadtraffic.dft.gov.uk/api';
const POSTCODES = 'https://api.postcodes.io/postcodes';

type LocalAuthority = { id: number; name: string; ons_code: string | null };

export type CountPoint = {
  count_point_id: number;
  aadf_year: number;
  road_name: string;
  road_type: string;
  latitude: string;
  longitude: string;
};

export type AadfRow = {
  count_point_id: number;
  year: number;
  all_motor_vehicles: number;
  all_hgvs: number;
};

type Page<T> = { data: T[]; current_page: number; last_page: number };
type ReverseGeo = { result: { codes: { admin_county: string | null } }[] | null };

/** Great-circle distance in km (pure). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Expand DfT's minor-road placeholders into something a human report can show (pure). */
export function prettyRoad(name: string): string {
  if (name === 'U') return 'Unclassified road';
  if (name === 'C') return 'Classified minor road';
  return name;
}

/** Nearest usable count point to the property, with its distance in metres (pure). */
export function nearestCountPoint(
  points: CountPoint[],
  lat: number,
  lng: number,
): { point: CountPoint; distanceM: number } | null {
  let best: CountPoint | null = null;
  let bestKm = Infinity;
  for (const p of points) {
    const plat = parseFloat(p.latitude);
    const plng = parseFloat(p.longitude);
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
    const d = haversineKm(lat, lng, plat, plng);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  if (!best) return null;
  return { point: best, distanceM: Math.round(bestKm * 1000) };
}

/** Sum all-motor-vehicle + HGV flows across a count point's direction rows (pure). */
export function aadfTotals(rows: AadfRow[]): { aadf: number; hgvs: number } {
  return {
    aadf: rows.reduce((s, r) => s + (r.all_motor_vehicles ?? 0), 0),
    hgvs: rows.reduce((s, r) => s + (r.all_hgvs ?? 0), 0),
  };
}

/** Follow the DfT API's page[number] pagination to completion (capped defensively). */
async function allPages<T>(baseUrl: string, maxPages = 25): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const p = await fetchJson<Page<T>>(`${baseUrl}${sep}page[number]=${page}`);
    rows.push(...p.data);
    if (!p.data.length || page >= (p.last_page ?? 1)) break;
  }
  return rows;
}

/**
 * Resolve the DfT local authority for a point. Tries the district GSS directly
 * (works for unitary/metropolitan/London), then falls back to the reverse-geocoded
 * county code for two-tier districts. Returns null if neither matches.
 */
async function resolveLocalAuthority(
  las: LocalAuthority[],
  lat: number,
  lng: number,
  districtCode?: string,
): Promise<LocalAuthority | null> {
  if (districtCode) {
    const direct = las.find((l) => l.ons_code === districtCode);
    if (direct) return direct;
  }
  // Two-tier district (E07...): DfT only carries the parent county (E10...).
  const geo = await fetchJson<ReverseGeo>(`${POSTCODES}?lon=${lng}&lat=${lat}`);
  const countyCode = geo.result?.[0]?.codes.admin_county ?? null;
  if (countyCode && countyCode !== 'E99999999') {
    return las.find((l) => l.ons_code === countyCode) ?? null;
  }
  return null;
}

export async function fetchTraffic(
  _postcode: string,
  lat: number,
  lng: number,
  districtCode?: string,
): Promise<TrafficInfo | null> {
  const key = `dftTraffic:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'dftTraffic', TTL.month, () =>
    failSoft('dft-traffic', async () => {
      const las = await fetchJson<LocalAuthority[]>(`${DFT}/local-authorities`);
      const la = await resolveLocalAuthority(las, lat, lng, districtCode);
      if (!la) throw new Error(`no DfT local authority for ${districtCode ?? `${lat},${lng}`}`);

      const points = await allPages<CountPoint>(
        `${DFT}/count-points?filter[local_authority_id]=${la.id}`,
      );
      const nearest = nearestCountPoint(points, lat, lng);
      if (!nearest) throw new Error(`no count points for LA ${la.id}`);

      const flows = await allPages<AadfRow>(
        `${DFT}/average-annual-daily-flow-by-direction?filter[count_point_id]=${nearest.point.count_point_id}&filter[year]=${nearest.point.aadf_year}`,
      );
      if (flows.length === 0) throw new Error(`no AADF for count point ${nearest.point.count_point_id}`);

      const { aadf, hgvs } = aadfTotals(flows);
      return {
        aadf,
        year: nearest.point.aadf_year,
        roadName: prettyRoad(nearest.point.road_name),
        roadType: nearest.point.road_type,
        distanceM: nearest.distanceM,
        hgvs,
        source: 'DfT Road Traffic Statistics (roadtraffic.dft.gov.uk)',
      } satisfies TrafficInfo;
    }),
  );
}
