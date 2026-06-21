/**
 * Server-only Census 2021 area profile (supporting info).
 *
 * Population + density (TS001) and labour-market rates (TS066) for the MSOA
 * containing the property, from the hosted ONS/Esri Census 2021 services. MSOA
 * is a neighbourhood scale (~8k people). Cached 30 days. Fail-soft.
 */

import type { AreaStats } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const BASE = 'https://services.arcgis.com/qHLhLQrcvEnxjtPr/arcgis/rest/services';
// MSOA is layer 5 in each service.
const POP = `${BASE}/Pop_Census21_EW_DemographyMigration_TS001_NumberOfUsualResidents/FeatureServer/5/query`;
const LAB = `${BASE}/Pop_Census21_EW_LabourMarket_TS066_EconomicActivityStatus/FeatureServer/5/query`;

type EsriResp = { features?: { attributes: Record<string, number | string> }[] };

function pointQuery(url: string, lat: number, lng: number, outFields: string): string {
  const p = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'false',
    outFields,
    f: 'json',
  });
  return `${url}?${p.toString()}`;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function fetchAreaStats(lat: number, lng: number): Promise<AreaStats | null> {
  const key = `areaStats:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'areaStats', TTL.month, () =>
    failSoft('areaStats', async () => {
      const [popRes, labRes] = await Promise.all([
        fetchJson<EsriResp>(pointQuery(POP, lat, lng, 'NAME,I36759D0,Shape__Area')),
        fetchJson<EsriResp>(pointQuery(LAB, lat, lng, 'I38798D0,I38796D0,I38816D0,I38846D0')),
      ]);
      const pop = popRes.features?.[0]?.attributes;
      if (!pop) throw new Error('no population for area');
      const population = num(pop.I36759D0) ?? 0;
      const areaM2 = num(pop.Shape__Area) ?? 0;
      const densityPerKm2 = areaM2 > 0 ? Math.round(population / (areaM2 / 1e6)) : 0;

      const lab = labRes.features?.[0]?.attributes ?? {};
      return {
        areaName: String(pop.NAME ?? ''),
        population,
        densityPerKm2,
        employmentRate: num(lab.I38798D0),
        economicActivityRate: num(lab.I38796D0),
        inactiveRate: num(lab.I38816D0),
        unemployedRate: num(lab.I38846D0),
      } satisfies AreaStats;
    }),
  );
}
