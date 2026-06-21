/**
 * Server-only postcode geocoder backed by postcodes.io (free, no key).
 *
 * The foundation every other M2 fetcher stands on: lat/lng for crime, flood,
 * amenities and maps; the local-authority GSS code for the Land Registry HPI
 * SPARQL query; the district name for HPI labelling and crime comparison.
 *
 * Cached 30 days (geocode results are effectively static). Fail-soft: a miss
 * returns null and the pull surfaces "location unavailable".
 */

import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

export type GeoResult = {
  postcode: string;
  lat: number;
  lng: number;
  /** Local authority district name, e.g. "Mansfield". */
  district: string;
  /** ONS GSS code for the district, e.g. "E07000174". Used by the HPI SPARQL. */
  districtCode: string;
  /** Region, e.g. "East Midlands". */
  region: string;
  /** Deprivation + census context (free from postcodes.io). */
  imdRank?: number;
  lsoa?: string;
  ward?: string;
  constituency?: string;
  adminCounty?: string;
  parish?: string;
};

type PostcodesIoResult = {
  status: number;
  result: {
    postcode: string;
    latitude: number;
    longitude: number;
    admin_district: string;
    admin_county: string | null;
    admin_ward: string | null;
    parish: string | null;
    region: string | null;
    lsoa: string | null;
    parliamentary_constituency: string | null;
    index_of_multiple_deprivation: number | null;
    codes: { admin_district: string };
  } | null;
};

/** Normalise a UK postcode to the canonical "OUTWARD INWARD" upper-case form. */
export function normalisePostcode(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (compact.length < 5) return compact;
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

const UK_POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;

/** Pull the first UK postcode out of a free-text address, or null if none. */
export function extractPostcode(address: string): string | null {
  const m = address.match(UK_POSTCODE_RE);
  return m ? normalisePostcode(m[1]) : null;
}

export async function geocodePostcode(rawPostcode: string): Promise<GeoResult | null> {
  const postcode = normalisePostcode(rawPostcode);
  const key = `geocode:${postcode}`;
  return cached(key, 'geocode', TTL.month, () =>
    failSoft('geocode', async () => {
      const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
      const data = await fetchJson<PostcodesIoResult>(url);
      if (!data.result) throw new Error(`postcode not found: ${postcode}`);
      const r = data.result;
      return {
        postcode: r.postcode,
        lat: r.latitude,
        lng: r.longitude,
        district: r.admin_district,
        districtCode: r.codes.admin_district,
        region: r.region ?? '',
        imdRank: r.index_of_multiple_deprivation ?? undefined,
        lsoa: r.lsoa ?? undefined,
        ward: r.admin_ward ?? undefined,
        constituency: r.parliamentary_constituency ?? undefined,
        adminCounty: r.admin_county ?? undefined,
        parish: r.parish ?? undefined,
      } satisfies GeoResult;
    }),
  );
}
