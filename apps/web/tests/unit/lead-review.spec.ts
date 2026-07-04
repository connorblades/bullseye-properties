import { describe, expect, it } from 'vitest';
import { fitForCandidate } from '@/server/actions/lead-review';
import type { ScrapedCandidate } from '@/lib/lead-intake';

function candidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    channel: 'portal',
    ...overrides,
  };
}

describe('fitForCandidate', () => {
  it('scores 0 when the candidate carries no criteria to match against', () => {
    // No criteria => nothing is scorable => pct 0 (scoreLeadFit contract).
    expect(fitForCandidate(candidate())).toBe(0);
  });

  it('scores a fully matching candidate at 100', () => {
    const pct = fitForCandidate(candidate({
      propertyType: 'Terraced',
      guidePrice: 100_000,
      expectedRent: 700, // 8400/yr on 100k = 8.4% gross yield, clears a 7% target
      criteria: {
        budget: '£130,000',
        areas: 'Mansfield',
        propertyType: 'Terraced',
        targetYield: '7%',
      },
    }));
    expect(pct).toBe(100);
  });

  it('partially scores when some criteria miss', () => {
    // Over budget + wrong area, but type matches and yield clears -> 2 of 4.
    const pct = fitForCandidate(candidate({
      address: '12 Browning Street, Sheffield, S1 2HH',
      propertyType: 'Terraced',
      guidePrice: 200_000,
      expectedRent: 1_400, // 16800/yr on 200k = 8.4% -> clears 7%
      criteria: {
        budget: '£130,000',
        areas: 'Mansfield',
        propertyType: 'Terraced',
        targetYield: '7%',
      },
    }));
    expect(pct).toBe(50);
  });
});
