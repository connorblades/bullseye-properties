import { describe, expect, it } from 'vitest';
import { computeRefurb, epcWorksCost } from '@/lib/refurb';
import { computePostViewingOffer } from '@/lib/outline';
import { emptyDeal, type Deal } from '@/lib/deal-store';
import { emptyInspection, type InspectionState } from '@/lib/inspection';
import { summariseGrantWorks } from '@/lib/epc-grants';

function deal(overrides: Partial<Deal> = {}): Deal {
  return emptyDeal('deal-1', { address: '1 Test Rd', ...overrides });
}

/** An inspection with one unit-priced step captured (consumer unit: £150 + £350). */
function withInspection(): InspectionState {
  const s = emptyInspection();
  s.steps['consumer-unit'] = { rating: 3, cost: { quantity: 1 } };
  return s;
}

const epcRecs = summariseGrantWorks(
  'D',
  [{ summary: 'Loft insulation', indicativeCostText: '£1,000 - £2,000', resultingBand: 'C' }],
  'C',
);

describe('computeRefurb - manual fallback', () => {
  it('matches the original itemised behaviour', () => {
    const d = deal({ refurb: { needed: true, items: [{ id: 'a', name: 'Rewire', cost: '£5,000' }], contingencyPct: '10', weeks: '' } });
    const r = computeRefurb(d);
    expect(r.source).toBe('manual');
    expect(r.subtotal).toBe(5000);
    expect(r.contingency).toBe(500);
    expect(r.total).toBe(5500);
    expect(r.contingencyLabel).toBe('10%');
  });
});

describe('computeRefurb - inspection sourced', () => {
  it('uses captured lines with a max(£3k, 15%) contingency', () => {
    const d = deal();
    d.viewing.inspection = withInspection();
    const r = computeRefurb(d);
    expect(r.source).toBe('inspection');
    expect(r.subtotal).toBe(500); // 150 material + 350 labour
    expect(r.contingency).toBe(3000); // max(£3k, 15% of 500)
    expect(r.total).toBe(3500);
    expect(r.contingencyLabel).toContain('3,000');
  });

  it('is preferred over any leftover manual items', () => {
    const d = deal({ refurb: { needed: true, items: [{ id: 'a', name: 'X', cost: '£9,999' }], contingencyPct: '10', weeks: '' } });
    d.viewing.inspection = withInspection();
    expect(computeRefurb(d).subtotal).toBe(500);
  });
});

describe('computeRefurb - EPC works to C', () => {
  it('surfaces EPC works but does not include them by default', () => {
    const d = deal();
    d.viewing.inspection = withInspection();
    d.publicData = { postcode: 'S1', status: {}, epcRecommendations: epcRecs };
    const r = computeRefurb(d);
    expect(r.epc?.cost).toBe(1500); // mid of 1000-2000
    expect(r.epc?.included).toBe(false);
    expect(r.subtotal).toBe(500);
  });

  it('folds EPC works into the subtotal when opted in', () => {
    const d = deal({ refurb: { needed: false, items: [], contingencyPct: '10', weeks: '', includeEpcWorks: true } });
    d.viewing.inspection = withInspection();
    d.publicData = { postcode: 'S1', status: {}, epcRecommendations: epcRecs };
    const r = computeRefurb(d);
    expect(r.epc?.included).toBe(true);
    expect(r.subtotal).toBe(2000); // 500 + 1500 EPC
    expect(r.source).toBe('inspection');
  });

  it('opting in with no inspection still drives an inspection-sourced total', () => {
    const d = deal({ refurb: { needed: false, items: [], contingencyPct: '10', weeks: '', includeEpcWorks: true } });
    d.publicData = { postcode: 'S1', status: {}, epcRecommendations: epcRecs };
    const r = computeRefurb(d);
    expect(r.source).toBe('inspection');
    expect(r.subtotal).toBe(1500);
    expect(r.total).toBe(4500); // 1500 + max(3000, 225)
  });
});

describe('epcWorksCost', () => {
  it('is null when already at target', () => {
    const d = deal();
    d.publicData = { postcode: 'S1', status: {}, epcRecommendations: summariseGrantWorks('B', [], 'C') };
    expect(epcWorksCost(d)).toBeNull();
  });
});

describe('computePostViewingOffer', () => {
  it('firms the indicative offer down by the refurb, rounded to £5k', () => {
    const d = deal({
      property: { ...emptyDeal('x').property, askingPrice: '£150,000' },
      refurb: { needed: true, items: [{ id: 'a', name: 'Works', cost: '£5,000' }], contingencyPct: '10', weeks: '' },
    });
    const pv = computePostViewingOffer(d);
    expect(pv.indicativeOffer).toBe(150000);
    expect(pv.refurbTotal).toBe(5500);
    expect(pv.suggestedOffer).toBe(145000); // 144,500 -> nearest £5k
    expect(pv.fromInspection).toBe(false);
  });

  it('is null when no offer anchor can be derived', () => {
    const pv = computePostViewingOffer(deal());
    expect(pv.suggestedOffer).toBeNull();
  });
});
