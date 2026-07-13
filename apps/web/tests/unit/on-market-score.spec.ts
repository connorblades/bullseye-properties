import { describe, expect, it } from 'vitest';
import { buildCompIndex, type AuctionComp } from '@/server/deal-radar/auction-match';
import { scoreOnMarketCandidate, needsOnMarketScore } from '@/server/deal-radar/on-market-score';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * In-platform on-market discount scorer (M2, AC-05). The comp index is built by
 * hand here (the same shape buildPatchCompIndex streams from Land Registry) so the
 * scoring is unit-tested without the multi-GB data files. The at-ingest wiring is a
 * staging-checklist item, like the rest of the DB-bound ingest path.
 */

// A terraced cohort on Church Street, Swinton (S64): median £120,000.
const comp = (price: number, over: Partial<AuctionComp> = {}): AuctionComp => ({
  district: 'S64',
  town: 'swinton',
  street: 'CHURCH STREET',
  ptype: 'T',
  price,
  date: '2024-06-01',
  ...over,
});
const CHURCH_STREET_COMPS: AuctionComp[] = [95, 100, 105, 110, 115, 118, 122, 128, 132, 138, 142, 145].map((k) =>
  comp(k * 1000)
);

function candidate(over: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    address: '14 Church Street, Swinton, S64 8QA',
    postcode: 'S64 8QA',
    propertyType: 'Terraced house',
    channel: 'portal',
    askingPrice: 96_000, // 20% below the £120k median
    listingUrl: 'https://rightmove.example/p/14-church-street',
    ...over,
  };
}

describe('needsOnMarketScore', () => {
  it('is true for an on-market listing with no discount signal', () => {
    expect(needsOnMarketScore(candidate(), 'on-market')).toBe(true);
  });

  it('is false when a discount signal is already present (feeder scored it)', () => {
    expect(needsOnMarketScore(candidate({ radar: { discountConfidence: 0.3 } }), 'on-market')).toBe(false);
  });

  it('is false for off-market leads (the historic lens owns those)', () => {
    expect(needsOnMarketScore(candidate(), 'off-market')).toBe(false);
  });
});

describe('scoreOnMarketCandidate', () => {
  const index = buildCompIndex(CHURCH_STREET_COMPS);

  it('scores a discounted on-market listing with radar + comp evidence', () => {
    const s = scoreOnMarketCandidate(candidate(), index)!;
    expect(s).not.toBeNull();
    expect(s.radar.estMarketValue).toBe(120_000); // comp median, 5k-rounded
    expect(s.radar.estAchievable).toBe(95_000); // asking, 5k-rounded
    expect(s.radar.discountReasons?.[0]).toContain('below');
    expect(s.discountEvidence.discountVsMedian).toBe(20);
    expect(s.discountEvidence.compCount).toBe(12);
    expect(s.discountEvidence.matchBasis).toBe('district');
    expect(s.discountEvidence.bucketLabel).toBe('S64');
    expect(s.discountEvidence.threshold).toBe(0.85);
    // The comps that prove it are carried (capped at 8, cheapest first).
    expect(s.discountEvidence.comps.length).toBe(8);
    expect(s.discountEvidence.comps[0].price).toBe(95_000);
    expect(s.discountEvidence.comps[0].ptype).toBe('Terraced');
  });

  it('returns null for a listing at or above the comp median (not discounted)', () => {
    expect(scoreOnMarketCandidate(candidate({ askingPrice: 145_000 }), index)).toBeNull();
  });

  it('returns null when no cohort matches the listing', () => {
    expect(scoreOnMarketCandidate(candidate({ address: '1 Nowhere Lane, Swinton, S64 8QA' }), index)).toBeNull();
  });

  it('honours a tunable threshold (a shallow discount passes a looser bar)', () => {
    // 118k asking is ~1.7% below the 120k median: below the default 0.85 bar, but
    // a 0.99 threshold (flag at 1%+ below) catches it.
    const shallow = candidate({ askingPrice: 118_000 });
    expect(scoreOnMarketCandidate(shallow, index)).toBeNull();
    const s = scoreOnMarketCandidate(shallow, index, { threshold: 0.99 })!;
    expect(s.discountEvidence.threshold).toBe(0.99);
  });
});
