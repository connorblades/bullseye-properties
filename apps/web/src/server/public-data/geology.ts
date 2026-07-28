/**
 * Server-only BGS bedrock geology + superficial deposit indicator.
 *
 * High-level ground-context indicator for DD: the bedrock rock unit and
 * lithology beneath the property, plus any mapped superficial deposit. Sourced
 * from the BGS "Geology 625k" open dataset via the free BGS OGC API Features
 * (GeoJSON) service. This is the FREE high-level indicator only; BGS sells
 * detailed ground-stability / subsidence hazard reports which we deliberately
 * do NOT use.
 *
 * At 1:625k scale polygons are large, so a small bbox around the point reliably
 * returns the polygon covering it; we take the first intersecting feature.
 * Cached 30 days per point. Fully fail-soft (returns null when unavailable).
 *
 * Data: BGS Geology 625k, Open Government Licence.
 * "Contains British Geological Survey materials (c) UKRI."
 */

import type { GeologyInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const BEDROCK_ITEMS = 'https://ogcapi.bgs.ac.uk/collections/bgsgeology625kbedrock/items';
const SUPERFICIAL_ITEMS = 'https://ogcapi.bgs.ac.uk/collections/bgsgeology625ksuperficial/items';

type BgsProps = {
  lex_d?: string; // rock unit / lexicon name, e.g. "PERMIAN ROCKS (UNDIFFERENTIATED)"
  rcs_d?: string; // rock composition / lithology
  max_period?: string; // geological period, e.g. "PERMIAN"
  age_onegl?: string; // OneGeology age label, fallback for period
};

type BgsFeatures = { features?: { properties?: BgsProps }[] };

/** Collapse BGS' space-padded blanks to a trimmed string. */
function clean(v?: string): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

/** BGS returns SHOUTING CAPS; render as "Sentence case". */
function sentenceCase(v: string): string {
  const lower = v.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Small bbox (~20m) around the point; CRS84 is lng,lat order. */
function pointBbox(lat: number, lng: number): string {
  const dLat = 0.0001;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  return [
    (lng - dLng).toFixed(6),
    (lat - dLat).toFixed(6),
    (lng + dLng).toFixed(6),
    (lat + dLat).toFixed(6),
  ].join(',');
}

async function firstProps(baseUrl: string, bbox: string): Promise<BgsProps | null> {
  const url = `${baseUrl}?bbox=${bbox}&limit=1&f=json`;
  const data = await fetchJson<BgsFeatures>(url);
  return data.features?.[0]?.properties ?? null;
}

export async function fetchGeology(
  _postcode: string,
  lat: number,
  lng: number,
): Promise<GeologyInfo | null> {
  const key = `geology:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'geology', TTL.month, () =>
    failSoft('geology', async () => {
      const bbox = pointBbox(lat, lng);

      const bedrock = await firstProps(BEDROCK_ITEMS, bbox);
      const bedrockName = clean(bedrock?.lex_d);
      if (!bedrockName) throw new Error('no bedrock polygon at point');

      // Superficial cover is optional: absence means bedrock at/near surface.
      const superficial = await failSoft('geology-superficial', () =>
        firstProps(SUPERFICIAL_ITEMS, bbox),
      );
      const superficialName = clean(superficial?.lex_d);

      const lithology = clean(bedrock?.rcs_d);
      const period = clean(bedrock?.max_period) || clean(bedrock?.age_onegl);

      return {
        bedrockName: sentenceCase(bedrockName),
        bedrockLithology: lithology ? sentenceCase(lithology) : 'Not specified',
        bedrockAge: period ? sentenceCase(period) : 'Unknown',
        superficialDeposit: superficialName ? sentenceCase(superficialName) : null,
        source: 'British Geological Survey - BGS Geology 625k (OGL)',
      } satisfies GeologyInfo;
    }),
  );
}
