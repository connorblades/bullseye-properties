import { describe, expect, it } from 'vitest';
import {
  combinedScore,
  compareByCombinedScore,
  rankScorePct,
  signalsOf,
  RANK_FLOOR,
} from '@/lib/lead-rank';
import type { CandidateRadar } from '@/lib/lead-intake';

/** Build a stored-row-shaped object for the comparator/signal helpers. */
function row(fitPct: number | null, radar?: CandidateRadar) {
  return { fitPct, radar };
}

describe('combinedScore (M4 fail-soft weighted product)', () => {
  it('is bounded in (0, 1] and never zero, even fully unscored', () => {
    const s = combinedScore({ fitPct: 0 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('returns 1 for a perfect, fully-signalled lead', () => {
    expect(combinedScore({ fitPct: 100, discountConfidence: 1, negotiability: 1 })).toBeCloseTo(1, 6);
  });

  it('treats an absent signal as neutral (does not penalise a lead for a missing score)', () => {
    // Only fit present: discount + negotiability absent -> factor 1 each.
    const fitOnly = combinedScore({ fitPct: 80 });
    const withNeutralNoise = combinedScore({
      fitPct: 80,
      discountConfidence: undefined,
      negotiability: undefined,
    });
    expect(fitOnly).toBeCloseTo(withNeutralNoise, 12);
    // fitOnly is just (0.8)^1 since the other two are neutral 1.
    expect(fitOnly).toBeCloseTo(0.8, 6);
  });

  it('a matched lead outranks an unmatched one, all else equal', () => {
    const matched = combinedScore({ fitPct: 60, discountConfidence: 0.5, negotiability: 0.5 });
    const unmatched = combinedScore({ fitPct: 0, discountConfidence: 0.5, negotiability: 0.5 });
    expect(matched).toBeGreaterThan(unmatched);
  });

  it('a present zero is floored, not annihilating - discount/negotiability still order unmatched leads', () => {
    // Both unmatched (fit 0, floored). The one with the stronger discount ranks higher.
    const strongDiscount = combinedScore({ fitPct: 0, discountConfidence: 0.9 });
    const weakDiscount = combinedScore({ fitPct: 0, discountConfidence: 0.1 });
    expect(strongDiscount).toBeGreaterThan(weakDiscount);
    expect(weakDiscount).toBeGreaterThan(0);
  });

  it('a scored-but-no-discount listing (discount 0) does not collapse to zero', () => {
    const s = combinedScore({ fitPct: 70, discountConfidence: 0, negotiability: 0.4 });
    expect(s).toBeGreaterThan(0);
    // The discount factor is floored to RANK_FLOOR, so the score is fit^1 * floor^0.6 * 0.4^0.6.
    const expected = Math.pow(0.7, 1) * Math.pow(RANK_FLOOR, 0.6) * Math.pow(0.4, 0.6);
    expect(s).toBeCloseTo(expected, 9);
  });

  it('negotiability refines order between two equally-matched, equally-discounted leads', () => {
    const high = combinedScore({ fitPct: 50, discountConfidence: 0.5, negotiability: 0.8 });
    const low = combinedScore({ fitPct: 50, discountConfidence: 0.5, negotiability: 0.2 });
    expect(high).toBeGreaterThan(low);
  });

  it('clamps out-of-range and non-finite inputs', () => {
    expect(combinedScore({ fitPct: 999, discountConfidence: 5, negotiability: -3 })).toBeCloseTo(
      combinedScore({ fitPct: 100, discountConfidence: 1, negotiability: 0 }),
      9
    );
    expect(Number.isFinite(combinedScore({ fitPct: NaN }))).toBe(true);
  });
});

describe('signalsOf', () => {
  it('reads fitPct column + radar jsonb, defaulting a null fit to 0', () => {
    const sig = signalsOf(
      row(null, { discountConfidence: 0.3, negotiability: { probability: 0.7, reasons: [], baseRate: 0.1 } })
    );
    expect(sig).toEqual({ fitPct: 0, discountConfidence: 0.3, negotiability: 0.7 });
  });

  it('omits absent radar signals rather than coercing them to 0', () => {
    const sig = signalsOf(row(42, {}));
    expect(sig.fitPct).toBe(42);
    expect(sig.discountConfidence).toBeUndefined();
    expect(sig.negotiability).toBeUndefined();
  });
});

describe('compareByCombinedScore', () => {
  it('orders the inbox best-combined-score first', () => {
    const strongMatch = row(85, { discountConfidence: 0.6 });
    const bigDiscountUnmatched = row(0, {
      discountConfidence: 0.95,
      negotiability: { probability: 0.9, reasons: [], baseRate: 0.2 },
    });
    const weak = row(20, {});
    const ordered = [weak, bigDiscountUnmatched, strongMatch].sort(compareByCombinedScore);
    expect(ordered[0]).toBe(strongMatch);
    // Fit dominates: a modest 20%-fit match still outranks an unmatched lead, even
    // one heavily discounted, so the unmatched-but-discounted lead sorts last.
    expect(ordered[1]).toBe(weak);
    expect(ordered[2]).toBe(bigDiscountUnmatched);
  });

  it('is deterministic on a tie (identical fully-unscored unmatched leads)', () => {
    const a = row(0, {});
    const b = row(0, {});
    expect(compareByCombinedScore(a, b)).toBe(0);
  });
});

describe('rankScorePct', () => {
  it('renders the combined score as a 0..100 integer', () => {
    expect(rankScorePct({ fitPct: 100, discountConfidence: 1, negotiability: 1 })).toBe(100);
    expect(rankScorePct({ fitPct: 80 })).toBe(80);
  });
});
