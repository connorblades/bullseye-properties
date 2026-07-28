/**
 * Server-only ONS NOMIS local labour-market signal (DD supporting info).
 *
 * Local-authority scale, keyed on the property's LA GSS code (districtCode).
 * Must-have: latest monthly Claimant Count (count + rate) from NM_162_1.
 * Best-effort extras: ASHE resident full-time median gross weekly pay (NM_30_1)
 * and the Annual Population Survey economic activity rate (NM_17_5). NOMIS is a
 * free, no-key public API. Cached 30 days. Fail-soft: if the claimant count is
 * missing the whole source returns null; a missing extra just stays undefined.
 */

import type { LabourMarketInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const BASE = 'https://www.nomisweb.co.uk/api/v01/dataset';

// NOMIS .data.json wraps each cell as { value, description }. We read the nested
// shape (the `select` param does not flatten it), so parse defensively.
type NomisCell<T> = { value: T; description?: string | number };
type NomisObs = {
  geography?: NomisCell<string>;
  measure?: NomisCell<number>;
  variable?: NomisCell<number>;
  time?: NomisCell<string | number>;
  obs_value?: NomisCell<number>;
};
type NomisResp = { obs?: NomisObs[] };

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function claimantCount(
  gss: string,
): Promise<{ areaName: string; count: number; period: string; rate?: number }> {
  // gender=0 (Total), age=0 (16+); measure 1=count, 2=rate; measures=20100 (Value).
  const url =
    `${BASE}/NM_162_1.data.json?geography=${gss}` +
    `&date=latest&gender=0&age=0&measure=1,2&measures=20100`;
  const data = await fetchJson<NomisResp>(url);
  const obs = data.obs ?? [];
  const countCell = obs.find((o) => o.measure?.value === 1);
  const count = num(countCell?.obs_value?.value);
  if (count === undefined) throw new Error(`no claimant count for ${gss}`);
  const rateCell = obs.find((o) => o.measure?.value === 2);
  return {
    areaName: String(countCell?.geography?.description ?? ''),
    count,
    period: String(countCell?.time?.description ?? ''),
    rate: num(rateCell?.obs_value?.value),
  };
}

async function residentEarnings(gss: string): Promise<{ pay: number; period: string } | undefined> {
  try {
    // sex=8 (Full Time Workers), item=2 (Median), pay=1 (Weekly pay - gross).
    const url =
      `${BASE}/NM_30_1.data.json?geography=${gss}&date=latest&sex=8&item=2&pay=1&measures=20100`;
    const data = await fetchJson<NomisResp>(url);
    const cell = data.obs?.[0];
    const pay = num(cell?.obs_value?.value);
    if (pay === undefined) return undefined;
    return { pay, period: String(cell?.time?.description ?? '') };
  } catch {
    return undefined;
  }
}

async function economicActivity(gss: string): Promise<{ rate: number; period: string } | undefined> {
  try {
    // variable=18 (Economic activity rate, aged 16-64), measures=20599 (Variable).
    const url = `${BASE}/NM_17_5.data.json?geography=${gss}&date=latest&variable=18&measures=20599`;
    const data = await fetchJson<NomisResp>(url);
    const cell = data.obs?.find((o) => o.variable?.value === 18) ?? data.obs?.[0];
    const rate = num(cell?.obs_value?.value);
    if (rate === undefined) return undefined;
    return { rate, period: String(cell?.time?.description ?? '') };
  } catch {
    return undefined;
  }
}

export async function fetchLabourMarket(
  _postcode: string,
  lat: number,
  lng: number,
  districtCode?: string,
): Promise<LabourMarketInfo | null> {
  const key = `labourMarket:${districtCode ?? `${lat.toFixed(3)},${lng.toFixed(3)}`}`;
  return cached(key, 'labourMarket', TTL.month, () =>
    failSoft('labourMarket', async () => {
      // NOMIS is queried by GSS geography code; without it we cannot resolve the LA.
      if (!districtCode) throw new Error('labourMarket needs a districtCode (LA GSS code)');

      // Must-have first; if this fails the whole source fail-softs to null.
      const cc = await claimantCount(districtCode);

      // Extras run in parallel and never block the must-have.
      const [earn, act] = await Promise.all([
        residentEarnings(districtCode),
        economicActivity(districtCode),
      ]);

      return {
        districtCode,
        areaName: cc.areaName,
        claimantCount: cc.count,
        claimantPeriod: cc.period,
        claimantRate: cc.rate,
        medianWeeklyPayGross: earn?.pay,
        earningsPeriod: earn?.period,
        economicActivityRate: act?.rate,
        economicActivityPeriod: act?.period,
      } satisfies LabourMarketInfo;
    }),
  );
}
