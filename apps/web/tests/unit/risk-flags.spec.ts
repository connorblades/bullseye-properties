import { describe, expect, it } from 'vitest';
import { emptyDeal, type Deal } from '@/lib/deal-store';
import { deriveRiskFlags, keyRiskFlags } from '@/lib/risk-flags';

function dealWith(publicData: Partial<Deal['publicData']>, location?: Partial<Deal['location']>): Deal {
  const d = emptyDeal('d-r', { address: '1 Test', source: 'direct' });
  return { ...d, publicData: { ...(d.publicData ?? {}), ...publicData } as Deal['publicData'], location: { ...d.location, ...(location ?? {}) } };
}

describe('deriveRiskFlags', () => {
  it('flags Flood Zone 3 as red and Zone 1 as good', () => {
    expect(deriveRiskFlags(dealWith({ flood: { band: 3, riskLabel: 'x', riversAndSea: '', surfaceWater: '', hasActiveWarning: false, source: 'EA' } as never }))[0].level).toBe('red');
    expect(deriveRiskFlags(dealWith({ flood: { band: 1, riskLabel: 'x', riversAndSea: '', surfaceWater: '', hasActiveWarning: false, source: 'EA' } as never })).find((f) => f.title.startsWith('Flood'))?.level).toBe('good');
  });

  it('flags EPC below C as amber and C+ as good', () => {
    expect(deriveRiskFlags(dealWith({ epc: { currentRating: 'D', currentScore: 58, potentialRating: 'B', potentialScore: 84 } as never })).find((f) => f.title.includes('EPC'))?.level).toBe('amber');
    expect(deriveRiskFlags(dealWith({ epc: { currentRating: 'B', currentScore: 84, potentialRating: 'A', potentialScore: 92 } as never })).find((f) => f.title.includes('EPC'))?.level).toBe('good');
  });

  it('flags higher crime as amber and lower as good', () => {
    const higher = deriveRiskFlags(dealWith({}, { crime: { total12mo: 400, per1000: '52', districtAvg: '40', comparison: 'higher', comparisonPct: '15%', breakdown: [] } }));
    expect(higher.find((f) => f.title.includes('Crime'))?.level).toBe('amber');
    const lower = deriveRiskFlags(dealWith({}, { crime: { total12mo: 100, per1000: '12', districtAvg: '40', comparison: 'lower', comparisonPct: '20%', breakdown: [] } }));
    expect(lower.find((f) => f.title.includes('Crime'))?.level).toBe('good');
  });

  it('flags a corporate owner as info', () => {
    const f = deriveRiskFlags(dealWith({ landOwnership: { titles: [{ dataset: 'ccod', titleNumber: 'X', proprietors: [{ name: 'BHWB Estates Ltd' }] }] } as never }));
    expect(f.find((x) => x.title.includes('Corporate'))?.detail).toContain('BHWB Estates Ltd');
  });

  it('sorts most severe first and keyRiskFlags keeps only red/amber', () => {
    const deal = dealWith(
      { flood: { band: 3, riskLabel: 'x', riversAndSea: '', surfaceWater: '', hasActiveWarning: false, source: 'EA' } as never, epc: { currentRating: 'B', currentScore: 84, potentialRating: 'A', potentialScore: 92 } as never },
    );
    const all = deriveRiskFlags(deal);
    expect(all[0].level).toBe('red'); // flood red before epc good
    const key = keyRiskFlags(deal);
    expect(key.every((f) => f.level === 'red' || f.level === 'amber')).toBe(true);
    expect(key.some((f) => f.level === 'good')).toBe(false);
  });

  it('returns nothing for a deal with no pulled data', () => {
    expect(keyRiskFlags(emptyDeal('d-x', { address: '1 Test', source: 'direct' }))).toHaveLength(0);
  });
});
