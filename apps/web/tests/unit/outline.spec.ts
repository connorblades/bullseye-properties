import { describe, expect, it } from 'vitest';
import { buildOutline, outlineRecommendation } from '@/lib/outline';
import { emptyDeal } from '@/lib/deal-store';

function browning() {
  return emptyDeal('d-out', {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    client: 'A. Investor',
    criteria: { budget: '£130,000', areas: 'Mansfield', propertyType: 'Semi-detached', targetYield: '7%+', refurbTolerance: '', epcRequirement: '', timeline: '' },
    property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '120000', documents: [] },
    financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '1800' },
  });
}

describe('buildOutline', () => {
  it('produces headline numbers, fit, and a recommendation', () => {
    const o = buildOutline(browning());
    expect(o.price).toBe(112500);
    expect(o.monthlyRent).toBe(800);
    expect(o.grossYield).toBeGreaterThan(0);
    expect(o.fitApplicable).toBe(4);
    expect(o.fitMet).toBe(4);
    expect(o.matched.length).toBe(4);
    expect(o.recommendation).toMatch(/matches 4 of 4/i);
    expect(o.recommendation).toMatch(/viewing/i);
  });

  it('falls back to a numbers-led recommendation when no criteria are set', () => {
    const deal = emptyDeal('d', {
      address: '1 A St, NG1 1AA',
      property: { type: '', bedrooms: '', bathrooms: '', floorArea: '', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '100000', documents: [] },
      financials: { purchasePrice: '100000', monthlyRent: '700', annualCosts: '' },
    });
    const rec = outlineRecommendation(deal);
    expect(rec).toMatch(/closer look/i);
    expect(rec).toMatch(/viewing/i);
    expect(rec).not.toMatch(/matches/i);
  });

  it('contains no em or en dashes (house style)', () => {
    const o = buildOutline(browning());
    expect(o.recommendation).not.toMatch(/[—–]/);
  });
});
