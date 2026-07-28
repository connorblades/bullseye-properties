/**
 * Server-only Environment Agency HISTORIC recorded-flooding integration.
 *
 * Source: EA "Recorded Flood Outlines" - per-event outlines of historic
 * recorded flooding (rivers, sea, groundwater, surface water), records back to
 * 1946. This COMPLEMENTS the planning flood zones (flood.ts) and the live
 * river-level stations (river-levels.ts): it answers "has this spot actually
 * flooded before, and why?".
 *
 * We query an ArcGIS FeatureServer with a ~1km envelope around the point and
 * return the count of distinct historic flood events plus, per event, the EA
 * name / cause / source / start-date.
 *
 * Endpoint: the canonical EA host
 *   environment.data.gov.uk/arcgis/rest/services/EA/RecordedFloodOutlines/MapServer
 * is an ArcGIS MapServer proxy that was returning HTTP 500 during build, so we
 * use the full national ArcGIS Online copy (identical EA schema:
 * event_code/name/start_date/end_date/flood_src/flood_caus). The canonical EA
 * URL is kept below as a documented fallback.
 *
 * OGL / free / no key. Cached 30 days per point. Fully fail-soft.
 *
 * IMPORTANT (surface in DD): absence of a recorded outline does NOT mean the
 * area has never flooded - only that the EA holds no record.
 */

import type { FloodHistoryInfo, RecordedFloodEvent } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

// National mirror of EA Recorded Flood Outlines (verified working).
const RFO_LAYER =
  'https://services9.arcgis.com/eNX73FDxjlKFtCtH/arcgis/rest/services' +
  '/Recorded_Flood_Outlines_(England)/FeatureServer/0/query';
// Canonical EA fallback (MapServer; flaky proxy at time of writing):
// 'https://environment.data.gov.uk/arcgis/rest/services/EA/RecordedFloodOutlines/MapServer/0/query'

const OUT_FIELDS = 'name,start_date,end_date,flood_src,flood_caus,event_code';
const MAX_EVENTS = 8;

// ArcGIS f=geojson returns date fields as epoch MILLISECONDS (numbers), negative
// for pre-1970 events; some servers emit ISO strings, so accept both.
export type RfoProps = {
  name?: string | null;
  start_date?: number | string | null;
  flood_src?: string | null;
  flood_caus?: string | null;
  event_code?: string | null;
};
type RfoGeoJson = { features?: { properties?: RfoProps }[]; error?: unknown };

const clean = (v?: string | null): string | undefined => {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : undefined;
};

/** Epoch-ms number or ISO string -> { iso, year, ms } or null. */
export function parseFloodDate(
  v?: number | string | null,
): { iso: string; year: number; ms: number } | null {
  if (v === null || v === undefined) return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return { iso: d.toISOString().slice(0, 10), year: d.getUTCFullYear(), ms };
}

/**
 * De-dupe recorded flood outlines into distinct events. One flood event is
 * stored as many adjacent polygons, so we key by name + start-date and report
 * distinct events, most-recent first, capped at MAX_EVENTS. Pure + unit-tested.
 */
export function dedupeFloodEvents(
  rows: RfoProps[],
): { recordCount: number; events: RecordedFloodEvent[] } {
  const byEvent = new Map<string, RecordedFloodEvent & { _ms: number }>();
  for (const p of rows) {
    const name = clean(p.name) ?? 'Unnamed recorded flood';
    const d = parseFloodDate(p.start_date);
    const dedupeKey = `${name}|${d?.ms ?? 'na'}`;
    if (byEvent.has(dedupeKey)) continue;
    byEvent.set(dedupeKey, {
      name,
      startDate: d?.iso,
      year: d?.year,
      cause: clean(p.flood_caus),
      source: clean(p.flood_src),
      _ms: d?.ms ?? -Infinity,
    });
  }
  const events: RecordedFloodEvent[] = [...byEvent.values()]
    .sort((a, b) => b._ms - a._ms)
    .slice(0, MAX_EVENTS)
    .map(({ _ms, ...e }) => e);
  return { recordCount: byEvent.size, events };
}

export async function fetchFloodHistory(
  _postcode: string,
  lat: number,
  lng: number,
): Promise<FloodHistoryInfo | null> {
  const key = `floodHistory:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'floodHistory', TTL.month, () =>
    failSoft('flood-history', async () => {
      // ~1km half-height box; widen longitude by 1/cos(lat) so it stays square.
      const dLat = 0.009;
      const dLng = dLat / Math.cos((lat * Math.PI) / 180);
      const envelope = [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
        .map((n) => n.toFixed(6))
        .join(',');

      const url =
        `${RFO_LAYER}?geometry=${encodeURIComponent(envelope)}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects` +
        `&outFields=${encodeURIComponent(OUT_FIELDS)}` +
        `&returnGeometry=false&outSR=4326&resultRecordCount=2000&f=geojson`;

      const data = await fetchJson<RfoGeoJson>(url);
      if (data.error) throw new Error('recorded-flood-outlines query error');

      const rows = (data.features ?? []).map((f) => f.properties ?? {});
      const { recordCount, events } = dedupeFloodEvents(rows);
      if (recordCount === 0) throw new Error('no recorded flood outlines near point');

      return {
        recordCount,
        events,
        source: 'Environment Agency Recorded Flood Outlines (historic recorded flooding)',
      } satisfies FloodHistoryInfo;
    }),
  );
}
