/**
 * Server-only planning.data.gov.uk integration (supporting info).
 *
 * Point query for statutory designations that materially affect a residential
 * deal: conservation areas (extra planning control + permitted-development
 * restrictions), listed buildings (consent burden), green belt and article-4
 * directions. Free national API, no key. Cached 30 days per postcode
 * (designations rarely change). Fail-soft.
 */

import type { PlanningInfo, PlanningDesignation } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const ENTITY_URL = 'https://www.planning.data.gov.uk/entity.json';

const DATASETS = [
  'conservation-area',
  'listed-building',
  'listed-building-outline',
  'green-belt',
  'article-4-direction-area',
  'flood-risk-zone',
] as const;

type Entity = { dataset?: string; name?: string; reference?: string };
type EntityResponse = { entities?: Entity[] };

function prettyDataset(dataset: string): string {
  return dataset
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function fetchPlanning(postcode: string, lat: number, lng: number): Promise<PlanningInfo | null> {
  const key = `planning:${postcode}`;
  return cached(key, 'planning', TTL.month, () =>
    failSoft('planning', async () => {
      const params = new URLSearchParams();
      params.set('longitude', String(lng));
      params.set('latitude', String(lat));
      params.set('limit', '50');
      for (const d of DATASETS) params.append('dataset', d);

      const data = await fetchJson<EntityResponse>(`${ENTITY_URL}?${params.toString()}`);
      const entities = data.entities ?? [];

      const seen = new Set<string>();
      const designations: PlanningDesignation[] = [];
      for (const e of entities) {
        if (!e.dataset) continue;
        const name = e.name || prettyDataset(e.dataset);
        const dedupe = `${e.dataset}:${name}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        designations.push({ dataset: e.dataset, name, reference: e.reference });
      }

      return {
        designations,
        conservationArea: designations.some((d) => d.dataset === 'conservation-area'),
        listed: designations.some((d) => d.dataset.startsWith('listed-building')),
      } satisfies PlanningInfo;
    }),
  );
}
