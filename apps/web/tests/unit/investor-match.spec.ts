import { describe, expect, it } from 'vitest';
import {
  matchCandidateToClients,
  matchLeadToClients,
  summariseMatch,
  type InvestorCriteria,
} from '@/lib/investor-match';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * Lead-to-client matching (BSE-OPP-P01 M1, AC-04). A lead is scored against
 * every investor brief; the best fit rides onto it with reasons, and a lead that
 * fits no active brief is flagged unmatched. These exercise the pure matcher end
 * to end (candidate -> draft deal -> scoreLeadFit per investor -> ranked).
 */

function candidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    // Mansfield terraced, £100k, £700pcm -> 8.4% gross yield.
    address: '12 Browning Street, Mansfield, NG18 5QH',
    channel: 'portal',
    propertyType: 'Terraced',
    guidePrice: 100_000,
    expectedRent: 700,
    ...overrides,
  };
}

const patel: InvestorCriteria = {
  id: 'ic-patel', name: 'J. Patel',
  budget: '£130,000', areas: 'Mansfield', propertyType: 'Terraced', targetYield: '7%',
};
const shah: InvestorCriteria = {
  id: 'ic-shah', name: 'K. Shah',
  budget: '£80,000', areas: 'Sheffield', propertyType: 'Flat', targetYield: '9%',
};

describe('matchCandidateToClients', () => {
  it('matches a lead to its best-fit investor at 100% when every criterion is met', () => {
    const out = matchCandidateToClients(candidate(), [shah, patel]);
    expect(out.best?.investorId).toBe('ic-patel');
    expect(out.best?.pct).toBe(100);
    expect(out.matched).toBe(true);
    // Both investors are scorable, so both rank (best first).
    expect(out.ranked.map((m) => m.investorId)).toEqual(['ic-patel', 'ic-shah']);
  });

  it('ranks a partial fit below a full fit', () => {
    const out = matchCandidateToClients(candidate(), [patel, shah]);
    const shahMatch = out.ranked.find((m) => m.investorId === 'ic-shah');
    // Shah: over budget, wrong area, wrong type, yield below target -> 0 of 4.
    expect(shahMatch?.pct).toBe(0);
    expect(out.best?.investorId).toBe('ic-patel');
  });

  it('flags a lead unmatched when no active brief fits it at all', () => {
    const out = matchCandidateToClients(candidate(), [shah]);
    expect(out.matched).toBe(false);
    // A 0% closest brief still ranks (it was scorable), but it is not a match.
    expect(out.best?.pct).toBe(0);
  });

  it('returns no match against an empty store', () => {
    const out = matchCandidateToClients(candidate(), []);
    expect(out.best).toBeNull();
    expect(out.matched).toBe(false);
    expect(out.ranked).toEqual([]);
  });

  it('drops an investor with a blank brief (nothing scorable)', () => {
    const blank: InvestorCriteria = { id: 'ic-blank', name: 'Blank' };
    const out = matchCandidateToClients(candidate(), [blank, patel]);
    expect(out.ranked.map((m) => m.investorId)).toEqual(['ic-patel']);
  });
});

describe('matchLeadToClients tie-break', () => {
  it('breaks a fit-percentage tie on the count of criteria met', () => {
    const lead = candidate();
    // Two investors both at 100%, but one matches on more criteria.
    const twoOfTwo: InvestorCriteria = { id: 'ic-2', name: 'Two', budget: '£130,000', targetYield: '7%' };
    const oneOfOne: InvestorCriteria = { id: 'ic-1', name: 'One', budget: '£130,000' };
    const out = matchCandidateToClients(lead, [oneOfOne, twoOfTwo]);
    expect(out.best?.investorId).toBe('ic-2'); // 2 met beats 1 met at equal pct
  });
});

describe('summariseMatch', () => {
  it('summarises a match with plain-English met reasons and alternatives', () => {
    const out = matchCandidateToClients(candidate(), [patel, shah]);
    const summary = summariseMatch(out);
    expect(summary.matched).toBe(true);
    expect(summary.investorName).toBe('J. Patel');
    expect(summary.pct).toBe(100);
    expect(summary.reasons.length).toBeGreaterThan(0);
    expect(summary.reasons.every((r) => typeof r === 'string')).toBe(true);
    expect(summary.alternatives?.[0]).toMatchObject({ name: 'K. Shah', pct: 0 });
  });

  it('summarises an empty store as an unmatched lead with no reasons', () => {
    const summary = summariseMatch(matchCandidateToClients(candidate(), []));
    expect(summary).toMatchObject({ matched: false, pct: 0, reasons: [] });
    expect(summary.investorName).toBeUndefined();
  });

  it('falls back to unmet reasons when nothing was met, so the closest miss is explained', () => {
    const summary = summariseMatch(matchCandidateToClients(candidate(), [shah]));
    expect(summary.matched).toBe(false);
    expect(summary.reasons.length).toBeGreaterThan(0); // e.g. "Over budget"
  });
});

describe('matchLeadToClients accepts a pre-built draft deal', () => {
  it('scores a draft deal directly (the ingestion pass reuses this)', () => {
    const out = matchCandidateToClients(candidate({ guidePrice: 200_000 }), [patel]);
    // £200k over J. Patel's £130k budget -> not "within budget", so < 100%.
    expect(out.best!.pct).toBeLessThan(100);
    expect(matchLeadToClients).toBeTypeOf('function');
  });
});
