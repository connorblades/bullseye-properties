import type { Deal } from './deal-store';
import { parseMoney, parseSoldMonth, hpiAdjustValue } from './deal-calcs';

/**
 * Comparable-led valuation (desktop, pre-viewing).
 *
 * GDV (estimated value) uses the surveyor's price-per-square-foot method,
 * HPI-adjusted so every comp is restated at today's prices before it is
 * compared:
 *
 *   adjustedSold = soldPrice * (latestHPI / soldMonthHPI)   // restate to today
 *   pricePerSqFt = adjustedSold / compSqFt
 *   impliedValue = pricePerSqFt * subjectSqFt
 *   GDV          = average(impliedValue over 3..10 comps), rounded to £5,000
 *
 * We require at least 3 usable comps and use at most 10. Rounding lands the
 * "148,953" type figure on a sensible "150,000".
 */

export const MIN_COMPS = 3;
export const MAX_COMPS = 10;

export type CompValuation = {
  id: string;
  address: string;
  soldPrice: number;
  soldMonth: string;
  floorArea: number;
  hpiRatio: number;
  adjustedPrice: number; // HPI-adjusted to today
  perSqFt: number;
  impliedValue: number; // perSqFt * subject sqft
};

export type GdvResult = {
  gdv: number; // rounded to nearest £5,000
  rawGdv: number; // unrounded average of implied values
  subjectSqFt: number;
  comps: CompValuation[]; // the usable comps actually used (3..10)
  usableCount: number;
  totalCount: number; // how many sales comps were entered
  capped: boolean; // more than MAX_COMPS usable; only the first MAX_COMPS used
};

function parseSqFt(s?: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Round to the nearest step (default £5,000). */
export function roundTo(n: number, step = 5000): number {
  return Math.round(n / step) * step;
}

/**
 * Compute the comparable-led GDV. Returns null when it cannot be evidenced:
 * no subject floor area, no HPI series, or fewer than MIN_COMPS usable comps
 * (each needs a sold price, a sold month, and a floor area).
 */
export function computeGdv(deal: Deal): GdvResult | null {
  const subjectSqFt = parseSqFt(deal.property.floorArea);
  const hpi = deal.publicData?.hpi;
  if (!subjectSqFt || !hpi) return null;

  const usable: CompValuation[] = [];
  for (const c of deal.salesComps) {
    const soldPrice = parseMoney(c.value);
    const floorArea = parseSqFt(c.floorArea);
    const soldMonth = parseSoldMonth(c.detail);
    if (!soldPrice || !floorArea || !soldMonth) continue;
    const adj = hpiAdjustValue(soldPrice, soldMonth, hpi);
    if (!adj) continue;
    const perSqFt = adj.adjusted / floorArea;
    usable.push({
      id: c.id,
      address: c.address,
      soldPrice,
      soldMonth,
      floorArea,
      hpiRatio: adj.ratio,
      adjustedPrice: adj.adjusted,
      perSqFt,
      impliedValue: perSqFt * subjectSqFt,
    });
  }

  if (usable.length < MIN_COMPS) return null;

  const capped = usable.length > MAX_COMPS;
  const used = usable.slice(0, MAX_COMPS);
  const rawGdv = used.reduce((s, c) => s + c.impliedValue, 0) / used.length;

  return {
    gdv: roundTo(rawGdv, 5000),
    rawGdv,
    subjectSqFt,
    comps: used,
    usableCount: usable.length,
    totalCount: deal.salesComps.length,
    capped,
  };
}

export type RentEstimate = {
  estimate: number; // rounded to nearest £25 pcm
  rawEstimate: number;
  growthPctUsed: number; // annual % applied
  asOfMonth: string; // month the estimate is uplifted to
  compCount: number;
};

const DEFAULT_RENT_GROWTH_PCT = 4;

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Estimate today's rent from like-for-like rental comps, each uplifted from the
 * month it rented to "today" by the local annual rent-growth assumption
 * (deal.growth.rentalGrowthPct, else 4%). "Today" is the latest HPI month when
 * available, else the most recent comp month. Returns null with no usable comps.
 */
export function estimateRent(deal: Deal): RentEstimate | null {
  const growthPct = parseFloat(deal.growth.rentalGrowthPct) || DEFAULT_RENT_GROWTH_PCT;
  const g = growthPct / 100;

  const rows = deal.rentalComps
    .map((c) => ({ rent: parseMoney(c.value), month: parseSoldMonth(c.detail) }))
    .filter((r): r is { rent: number; month: string } => r.rent != null && r.month != null);
  if (rows.length === 0) return null;

  const latestComp = rows.map((r) => r.month).sort().at(-1)!;
  const asOfMonth = deal.publicData?.hpi?.latestMonth ?? latestComp;

  const uplifted = rows.map((r) => {
    const years = Math.max(0, monthsBetween(r.month, asOfMonth) / 12);
    return r.rent * Math.pow(1 + g, years);
  });
  const rawEstimate = uplifted.reduce((s, v) => s + v, 0) / uplifted.length;

  return {
    estimate: roundTo(rawEstimate, 25),
    rawEstimate,
    growthPctUsed: growthPct,
    asOfMonth,
    compCount: rows.length,
  };
}
