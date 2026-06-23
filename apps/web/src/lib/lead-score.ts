import type { Deal } from './deal-store';
import { computeFinancials, parseMoney } from './deal-calcs';

/**
 * Lead fit score (M5) - how well a deal's property matches the investor's stated
 * criteria. Pure + client-safe; used for a "fit %" badge on the pipeline board
 * and as the scoring core for criteria-matched leads. Heuristic, not a promise:
 * scores only the criteria the partner actually filled in.
 */

export type LeadScore = {
  met: number;
  applicable: number;
  pct: number;            // 0..100 (0 when no criteria are scorable)
  reasons: { ok: boolean; text: string }[];
};

/** Parse a budget like "£350,000", "350000", "350k", "0.35m" to a number. */
export function parseBudget(s?: string): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/([0-9]*\.?[0-9]+)\s*([km])?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') n *= 1_000;
  else if (unit === 'm') n *= 1_000_000;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a target yield like "7%+", "7%", "7" to a number (percent). */
export function parseYieldTarget(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/([0-9]*\.?[0-9]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const tokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

function matchesType(criteriaType: string, propertyType: string): boolean {
  const want = tokens(criteriaType);
  const have = propertyType.toLowerCase();
  return want.some((t) => have.includes(t));
}

function matchesArea(areas: string, address: string): boolean {
  const hay = address.toLowerCase();
  return areas
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length >= 3)
    .some((a) => hay.includes(a));
}

export function scoreLeadFit(deal: Deal): LeadScore {
  const fin = computeFinancials(deal);
  const reasons: { ok: boolean; text: string }[] = [];
  let met = 0;
  let applicable = 0;

  // Budget vs price
  const budget = parseBudget(deal.criteria.budget);
  const price = parseMoney(deal.financials.purchasePrice) ?? parseMoney(deal.property.askingPrice);
  if (budget && price) {
    applicable++;
    if (price <= budget) { met++; reasons.push({ ok: true, text: 'Within budget' }); }
    else reasons.push({ ok: false, text: 'Over budget' });
  }

  // Gross yield vs target
  const target = parseYieldTarget(deal.criteria.targetYield);
  if (target && fin.grossYield > 0) {
    applicable++;
    if (fin.grossYield >= target) { met++; reasons.push({ ok: true, text: `Yield ${fin.grossYield.toFixed(1)}% ≥ ${target}%` }); }
    else reasons.push({ ok: false, text: `Yield ${fin.grossYield.toFixed(1)}% < ${target}%` });
  }

  // Property type
  if (deal.criteria.propertyType && deal.property.type) {
    applicable++;
    if (matchesType(deal.criteria.propertyType, deal.property.type)) { met++; reasons.push({ ok: true, text: 'Type matches' }); }
    else reasons.push({ ok: false, text: 'Type differs from criteria' });
  }

  // Area
  if (deal.criteria.areas && deal.address) {
    applicable++;
    if (matchesArea(deal.criteria.areas, deal.address)) { met++; reasons.push({ ok: true, text: 'In a preferred area' }); }
    else reasons.push({ ok: false, text: 'Outside stated areas' });
  }

  const pct = applicable ? Math.round((met / applicable) * 100) : 0;
  return { met, applicable, pct, reasons };
}
