/**
 * Server-only Environment Agency flood integration (M2-T3).
 *
 * Two EA sources combine into one FloodInfo:
 *
 *  1. Flood band (1/2/3) — the EA "Flood Map for Planning (Rivers and Sea)"
 *     flood zones, served as OGC API Features. The collection holds only the
 *     Flood Zone 2 and 3 polygons; anything outside them is Zone 1 (low risk)
 *     by absence. We query a small bounding box around the point and take the
 *     highest zone found. (BUILD §M2-T3 names the flood-monitoring endpoint;
 *     that one only exposes live warnings/stations, not planning zones, so we
 *     use it for warning context below and the planning-zones dataset for the
 *     actual band. Deviation logged in STATUS.)
 *
 *  2. Active-warning flag — the flood-monitoring `/id/floods` feed, for any
 *     live flood warning or alert near the point.
 *
 * Cached 30 days per postcode (BUILD §7). Fully fail-soft.
 */

import type { FloodInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const FLOOD_ZONES_ITEMS =
  'https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones' +
  '/ogc/features/v1/collections/Flood_Zones_2_3_Rivers_and_Sea/items';

const FLOODS_FEED = 'https://environment.data.gov.uk/flood-monitoring/id/floods';

type OgcFeatures = {
  features: { properties: { flood_zone?: string; flood_source?: string } }[];
};

type FloodsFeed = { items: unknown[] };

function bandLabel(band: 1 | 2 | 3): { riskLabel: string; riversAndSea: string } {
  switch (band) {
    case 3:
      return {
        riskLabel: 'Flood Zone 3 - High risk',
        riversAndSea: 'Within Flood Zone 3: land with a 1% (rivers) or 0.5% (sea) or greater annual chance of flooding.',
      };
    case 2:
      return {
        riskLabel: 'Flood Zone 2 - Medium risk',
        riversAndSea: 'Within Flood Zone 2: land with a 0.1% to 1% (rivers) or 0.1% to 0.5% (sea) annual chance of flooding.',
      };
    case 1:
      return {
        riskLabel: 'Flood Zone 1 - Low risk',
        riversAndSea: 'Outside Flood Zones 2 and 3: less than 0.1% annual chance of river or sea flooding.',
      };
  }
}

/** Highest planning flood zone covering a small box around the point. */
async function fetchBand(lat: number, lng: number): Promise<{ band: 1 | 2 | 3; source: string } | null> {
  // ~30m box. bbox is minLon,minLat,maxLon,maxLat. Latitude pad is constant;
  // longitude pad widens by 1/cos(lat) so the box stays roughly square.
  const dLat = 0.0003;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const bbox = `${(lng - dLng).toFixed(6)},${(lat - dLat).toFixed(6)},${(lng + dLng).toFixed(6)},${(lat + dLat).toFixed(6)}`;
  const url = `${FLOOD_ZONES_ITEMS}?bbox=${bbox}&limit=20&f=json`;
  const data = await fetchJson<OgcFeatures>(url);
  const zones = new Set((data.features ?? []).map((f) => f.properties?.flood_zone));
  if (zones.has('FZ3')) return { band: 3, source: 'EA Flood Map for Planning (Rivers and Sea)' };
  if (zones.has('FZ2')) return { band: 2, source: 'EA Flood Map for Planning (Rivers and Sea)' };
  return { band: 1, source: 'EA Flood Map for Planning (Rivers and Sea)' };
}

/** Any live flood warning/alert near the point. Defaults false on failure. */
async function fetchActiveWarning(lat: number, lng: number): Promise<boolean> {
  const result = await failSoft('flood-warnings', async () => {
    const url = `${FLOODS_FEED}?lat=${lat}&long=${lng}&dist=10`;
    const data = await fetchJson<FloodsFeed>(url);
    return (data.items ?? []).length > 0;
  });
  return result ?? false;
}

export async function fetchFlood(postcode: string, lat: number, lng: number): Promise<FloodInfo | null> {
  const key = `flood:${postcode}`;
  return cached(key, 'flood', TTL.month, () =>
    failSoft('flood', async () => {
      const banded = await fetchBand(lat, lng);
      if (!banded) throw new Error('flood zone lookup failed');
      const hasActiveWarning = await fetchActiveWarning(lat, lng);
      const { riskLabel, riversAndSea } = bandLabel(banded.band);
      return {
        band: banded.band,
        riskLabel,
        riversAndSea,
        surfaceWater: 'Surface-water risk not separately assessed in this report version.',
        hasActiveWarning,
        source: banded.source,
      } satisfies FloodInfo;
    }),
  );
}
