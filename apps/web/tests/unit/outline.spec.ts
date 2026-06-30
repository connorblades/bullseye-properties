import { describe, expect, it } from 'vitest';
import { buildOutline, outlineRecommendation, computeIndicativeOffer } from '@/lib/outline';
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

describe('computeIndicativeOffer', () => {
  it('uses the average of sales comparables for market value', () => {
    const deal = browning();
    deal.salesComps = [
      { id: 's1', address: '8 Browning St', detail: 'Sold', value: '£120,000' },
      { id: 's2', address: '21 Tennyson Ave', detail: 'Sold', value: '£130,000' },
    ];
    const o = computeIndicativeOffer(deal);
    expect(o.marketValue).toBe(125000);
    expect(o.marketValueBasis).toMatch(/2 sales comparable/i);
  });

  it('falls back to the guide price when there are no comparables', () => {
    const o = computeIndicativeOffer(browning()); // askingPrice 120000, no comps
    expect(o.marketValue).toBe(120000);
    expect(o.marketValueBasis).toMatch(/guide/i);
  });

  it('derives the yield-max price and takes the lower anchor as the suggested offer', () => {
    // rent 800pcm => 9600/yr; 7% target => max 137,143; market value 120,000 => offer = 120,000
    const o = computeIndicativeOffer(browning());
    expect(o.targetYieldPct).toBe(7);
    expect(o.yieldMaxPrice).toBe(137143);
    expect(o.suggestedOffer).toBe(120000);
  });

  it('returns nulls when there is nothing to anchor on', () => {
    const deal = browning();
    deal.salesComps = [];
    deal.property.askingPrice = '';
    deal.financials.purchasePrice = '';
    deal.financials.monthlyRent = '';
    deal.criteria.targetYield = '';
    const o = computeIndicativeOffer(deal);
    expect(o.suggestedOffer).toBeNull();
    expect(o.marketValue).toBeNull();
  });
});
