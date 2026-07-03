/**
 * Refurb estimate bridge (M6-T5) - pure, client-safe, testable.
 *
 * The single place that decides where the report's refurb figure comes from:
 *  - when a guided inspection has been captured (M6-T3), the on-site measured
 *    lines + contingency of max(£3,000, 15%) drive it;
 *  - otherwise it falls back to the manually itemised `deal.refurb` (the
 *    pre-inspection behaviour, byte-for-byte).
 * Optionally folds in the EPC works-to-C cost (M6-T2) when the partner opts in.
 *
 * `computeFinancials` reads `computeRefurb` so the report, the growth
 * projection and the indicative offer all move together off one number. No
 * 'use client', no fetch - safe from server (PDF) and client alike.
 */

import type { Deal } from './deal-store';
import type { GrantWorks } from './epc-grants';
import {
  buildInspectionLines,
  contingencyFor,
  CONTINGENCY_PCT,
  MIN_CONTINGENCY_GBP,
  type CostBreakdown,
} from './inspection';

export type RefurbSource = 'inspection' | 'manual';

export interface RefurbSummary {
  source: RefurbSource;
  /** One line per costed item (measured take-offs carry a `basis`). */
  lines: CostBreakdown[];
  materialSubtotal: number;
  labourSubtotal: number;
  /** Works before contingency. */
  subtotal: number;
  contingency: number;
  /** Human label for the contingency basis, e.g. "max £3,000 or 15%". */
  contingencyLabel: string;
  total: number;
  /**
   * The pulled EPC works-to-C, when available - always surfaced for context.
   * `included` reflects whether its cost is folded into the subtotal above.
   */
  epc?: { works: GrantWorks; cost: number; included: boolean };
}

const round = (n: number) => Math.round(n);

/** A number from a free-text cost string ("£1,200"), else 0. */
function money(value: string): number {
  const n = parseFloat((value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The EPC works-to-C cost the partner can fold into the refurb, when present. */
export function epcWorksCost(deal: Deal): { works: GrantWorks; cost: number } | null {
  const gw = deal.publicData?.epcRecommendations;
  if (!gw || gw.alreadyAtTarget) return null;
  const cost = gw.cost.mid ?? gw.cost.high ?? gw.cost.low ?? 0;
  if (cost <= 0) return null;
  return { works: gw, cost: round(cost) };
}

/**
 * The refurb estimate that flows into the report + financials + offer.
 *
 * Preference order:
 *  1. captured inspection lines (+ optional EPC works) -> max(£3k, 15%) contingency;
 *  2. manual `deal.refurb.items` -> the entered contingency %.
 */
export function computeRefurb(deal: Deal): RefurbSummary {
  const inspection = deal.viewing?.inspection;
  const inspectionLines = inspection ? buildInspectionLines(inspection) : [];

  const epc = epcWorksCost(deal);
  const includeEpc = Boolean(epc && deal.refurb?.includeEpcWorks);

  const hasInspection = inspectionLines.length > 0 || includeEpc;

  if (hasInspection) {
    const lines = [...inspectionLines];
    if (epc && includeEpc) {
      lines.push({
        label: `EPC improvements to reach band ${epc.works.targetBand}`,
        material: epc.cost,
        labour: 0,
        total: epc.cost,
        basis: `Indicative EPC certificate cost for ${epc.works.measuresToTarget.length} measure${epc.works.measuresToTarget.length === 1 ? '' : 's'} to reach ${epc.works.targetBand}`,
      });
    }
    const materialSubtotal = lines.reduce((s, l) => s + l.material, 0);
    const labourSubtotal = lines.reduce((s, l) => s + l.labour, 0);
    const subtotal = materialSubtotal + labourSubtotal;
    const contingency = contingencyFor(subtotal);
    return {
      source: 'inspection',
      lines,
      materialSubtotal,
      labourSubtotal,
      subtotal,
      contingency,
      contingencyLabel: `max £${MIN_CONTINGENCY_GBP.toLocaleString('en-GB')} or ${CONTINGENCY_PCT}%`,
      total: subtotal + contingency,
      ...(epc ? { epc: { works: epc.works, cost: epc.cost, included: includeEpc } } : {}),
    };
  }

  // Manual fallback - identical to the original computeFinancials behaviour.
  const lines: CostBreakdown[] = deal.refurb.items.map((i) => {
    const cost = money(i.cost);
    return { label: i.name || 'Refurbishment item', material: cost, labour: 0, total: cost };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const contingencyPct = parseFloat(deal.refurb.contingencyPct) || 0;
  // Unrounded, to match the original computeFinancials manual behaviour exactly.
  const contingency = subtotal * (contingencyPct / 100);
  return {
    source: 'manual',
    lines,
    materialSubtotal: subtotal,
    labourSubtotal: 0,
    subtotal,
    contingency,
    contingencyLabel: `${contingencyPct}%`,
    total: subtotal + contingency,
    ...(epc ? { epc: { works: epc.works, cost: epc.cost, included: false } } : {}),
  };
}
