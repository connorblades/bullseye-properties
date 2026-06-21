/**
 * Server-only planning-applications integration (supporting info).
 *
 * PlanIt (planit.org.uk) is a free aggregator of UK local-authority planning
 * applications - one of the primary sources Searchland-style tools resell. We
 * query a small radius around the property and return recent applications with
 * type, status and dates. Cached 7 days per (lat, lng). Fully fail-soft.
 *
 * (Distinct from planning.ts, which gives statutory designations from
 * planning.data.gov.uk; this gives the live application history.)
 */

import type { PlanningApplication } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const PLANIT_URL = 'https://www.planit.org.uk/api/applics/json';
const RADIUS_KM = 0.5;

type PlanItRecord = {
  name?: string;
  description?: string;
  app_type?: string;
  app_state?: string;
  start_date?: string;
  decided_date?: string;
  distance?: number; // metres
  address?: string;
  url?: string;
  link?: string;
};
type PlanItResponse = { records?: PlanItRecord[] };

const RESIDENTIAL_RE = /\b(dwelling|residential|housing|new homes?|flats?|apartments?|bungalows?)\b/i;
const UNITS_RE = /\b(\d{1,4})\s*(?:no\.?\s*)?(?:dwelling|home|unit|house|flat|apartment)s?\b/i;

function parseUnits(description: string): number | undefined {
  const m = description.match(UNITS_RE);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function fetchPlanningApplications(
  lat: number,
  lng: number,
): Promise<PlanningApplication[] | null> {
  const key = `planningApps:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached(key, 'planningApplications', TTL.week, () =>
    failSoft('planning-applications', async () => {
      const url =
        `${PLANIT_URL}?lat=${lat}&lng=${lng}&krad=${RADIUS_KM}` +
        `&pg_sz=40&sort=-start_date`;
      const data = await fetchJson<PlanItResponse>(url);
      const records = data.records ?? [];
      if (records.length === 0) return [];

      return records.map((r) => {
        const description = (r.description ?? '').trim();
        const residential = RESIDENTIAL_RE.test(description);
        const units = residential ? parseUnits(description) : undefined;
        return {
          reference: r.name ?? '',
          description,
          appType: r.app_type,
          status: r.app_state,
          startDate: r.start_date,
          decidedDate: r.decided_date,
          distanceKm:
            typeof r.distance === 'number' ? Math.round((r.distance / 1000) * 100) / 100 : undefined,
          address: r.address,
          url: r.url ?? r.link,
          residential,
          ...(units ? { units } : {}),
        };
      }) satisfies PlanningApplication[];
    }),
  );
}
