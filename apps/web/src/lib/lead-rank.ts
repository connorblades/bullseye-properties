/**
 * Combined lead ranking (BSE-OPP-P01 M4, AC-07).
 *
 * Pure + client-safe: no server imports, so the review inbox (client) and the
 * ingest/digest paths (server) share one ordering. M4 does NOT re-score anything -
 * it folds the three signals the earlier milestones already computed and stored on
 * each candidate into a single order:
 *
 *   - client-fit      `fitPct` 0..100          (M1 matchLeadToClients)
 *   - discount        `radar.discountConfidence` 0..1  (M2 on-market matcher)
 *   - negotiability   `radar.negotiability.probability` 0..1  (M3 propensity)
 *
 * The PLAN calls for "discount x negotiability x client-fit". A literal product
 * annihilates any lead missing a signal (an unmatched lead has fit 0; a listing
 * off the learned cohort carries no negotiability), collapsing most of the inbox
 * to a 0 tie. So this is a FAIL-SOFT weighted product:
 *
 *   score = fitFactor^wFit x discountFactor^wDisc x negFactor^wNeg
 *
 *   - each present factor is clamped to [FLOOR, 1] so no single zero annihilates;
 *   - an ABSENT signal is neutral (factor 1) - it neither helps nor hurts;
 *   - client-fit is always present (0 = unmatched) and weighted to dominate, so a
 *     matched lead outranks an unmatched one, while discount + negotiability refine
 *     order within each band and still rank unmatched leads amongst themselves.
 */

import type { CandidateRadar } from './lead-intake';

/** Weight (exponent) on each factor. Fit dominates; discount and negotiability refine. */
export const RANK_WEIGHTS = { fit: 1.0, discount: 0.6, negotiability: 0.6 } as const;

/**
 * Floor applied to a PRESENT factor before it enters the product, so a genuine
 * zero (unmatched fit, a scored-but-no-discount listing) ranks low without
 * annihilating the other signals. An ABSENT signal is neutral (1), not floored.
 */
export const RANK_FLOOR = 0.02;

/** The three signals a lead is ranked on, read off a stored candidate row. */
export interface RankSignals {
  /** Client-fit 0..100 (the `fit_pct` column). Always present; 0 = unmatched. */
  fitPct: number;
  /** On-market discount confidence 0..1, or undefined when not scored. */
  discountConfidence?: number;
  /** Off-market negotiability probability 0..1, or undefined when not scored. */
  negotiability?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** A present signal floored to [FLOOR, 1]; an absent one is neutral (1). */
function factor(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 1;
  return Math.max(clamp01(value), RANK_FLOOR);
}

/**
 * The combined rank score in (0, 1]. Higher ranks first. Fail-soft: an absent
 * signal is neutral, a present zero is floored, so the inbox never degenerates to
 * a wall of zeroes while every lead is not yet fully scored.
 */
export function combinedScore(sig: RankSignals): number {
  // Fit is always "present" (0 = unmatched); floor it so an unmatched lead still
  // orders by its discount/negotiability instead of collapsing to 0.
  const fit = Math.max(clamp01((sig.fitPct ?? 0) / 100), RANK_FLOOR);
  const disc = factor(sig.discountConfidence);
  const neg = factor(sig.negotiability);
  return (
    Math.pow(fit, RANK_WEIGHTS.fit) *
    Math.pow(disc, RANK_WEIGHTS.discount) *
    Math.pow(neg, RANK_WEIGHTS.negotiability)
  );
}

/** Pull the ranking signals off a stored candidate row (fitPct column + radar jsonb). */
export function signalsOf(row: { fitPct?: number | null; radar?: CandidateRadar }): RankSignals {
  return {
    fitPct: row.fitPct ?? 0,
    discountConfidence: numberOrUndefined(row.radar?.discountConfidence),
    negotiability: numberOrUndefined(row.radar?.negotiability?.probability),
  };
}

function numberOrUndefined(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** The combined score as a 0..100 integer for display on the review card. */
export function rankScorePct(sig: RankSignals): number {
  return Math.round(combinedScore(sig) * 100);
}

/**
 * Comparator ordering the review inbox best-first by combined score. A stable
 * tie-break on fitPct then discount keeps ordering deterministic when two leads
 * score identically (e.g. two fully-unscored, unmatched leads).
 */
export function compareByCombinedScore(
  a: { fitPct?: number | null; radar?: CandidateRadar },
  b: { fitPct?: number | null; radar?: CandidateRadar }
): number {
  const sa = signalsOf(a);
  const sb = signalsOf(b);
  const diff = combinedScore(sb) - combinedScore(sa);
  if (diff !== 0) return diff;
  if ((sb.fitPct ?? 0) !== (sa.fitPct ?? 0)) return (sb.fitPct ?? 0) - (sa.fitPct ?? 0);
  return (sb.discountConfidence ?? 0) - (sa.discountConfidence ?? 0);
}
