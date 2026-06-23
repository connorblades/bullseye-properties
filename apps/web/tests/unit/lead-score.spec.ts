import { describe, expect, it } from 'vitest';
import { scoreLeadFit, parseBudget, parseYieldTarget } from '@/lib/lead-score';
import { emptyDeal } from '@/lib/deal-store';

describe('parseBudget', () => {
  it('parses pounds, commas, k and m', () => {
    expect(parseBudget('£350,000')).toBe(350000);
    expect(parseBudget('350000')).toBe(350000);
    expect(parseBudget('350k')).toBe(350000);
    expect(parseBudget('0.35m')).toBe(350000);
    expect(parseBudget('')).toBeNull();
  });
});

describe('parseYieldTarget', () => {
  it('parses "7%+", "7%", "7"', () => {
    expect(parseYieldTarget('7%+')).toBe(7);
    expect(parseYieldTarget('7%')).toBe(7);
    expect(parseYieldTarget('7.5')).toBe(7.5);
    expect(parseYieldTarget('')).toBeNull();
  });
});

describe('scoreLeadFit', () => {
  it('scores a strong match high', () => {
    const deal = emptyDeal('d', {
      address: '12 Browning Street, Mansfield, NG18 5QH',
      criteria: { budget: '£130,000', areas: 'Mansfield, Worksop', propertyType: 'Semi-detached', targetYield: '7%+', refurbTolerance: '', epcRequirement: '', timeline: '' },
      property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '120000', documents: [] },
      financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '1800' },
    });
    const s = scoreLeadFit(deal);
    expect(s.applicable).toBe(4); // budget, yield, type, area all scorable
    expect(s.met).toBe(4);
    expect(s.pct).toBe(100);
  });

  it('flags over-budget and area mismatch', () => {
    const deal = emptyDeal('d', {
      address: '9 Random Road, Leeds, LS1 1AA',
      criteria: { budget: '£100,000', areas: 'Mansfield', propertyType: 'Detached', targetYield: '10%+', refurbTolerance: '', epcRequirement: '', timeline: '' },
      property: { type: 'Semi-detached', bedrooms: '2', bathrooms: '1', floorArea: '', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '150000', documents: [] },
      financials: { purchasePrice: '150000', monthlyRent: '700', annualCosts: '1500' },
    });
    const s = scoreLeadFit(deal);
    expect(s.applicable).toBe(4);
    expect(s.met).toBeLessThan(4);
    expect(s.reasons.some((r) => !r.ok && /budget/i.test(r.text))).toBe(true);
    expect(s.reasons.some((r) => !r.ok && /area/i.test(r.text))).toBe(true);
  });

  it('returns 0% / 0 applicable when no criteria are filled in', () => {
    const s = scoreLeadFit(emptyDeal('d', { address: '1 A St' }));
    expect(s.applicable).toBe(0);
    expect(s.pct).toBe(0);
  });
});
