import { describe, expect, it } from 'vitest';
import { computeGdv, estimateRent, roundTo, MIN_COMPS } from '@/lib/comps';
import { emptyDeal } from '@/lib/deal-store';

// HPI series: index 100 in 2024-01 rising to 110 at the latest month 2026-06.
const hpi = {
  district: 'Mansfield',
  districtCode: 'E07',
  latestMonth: '2026-06',
  latestIndex: 110,
  latestAvgPrice: 165000,
  cagr10yrPct: 4.2,
  series: [
    { month: '2024-01', index: 100 },
    { month: '2025-01', index: 105 },
    { month: '2026-06', index: 110 },
  ],
};

function dealWith(opts: { subjectSqFt?: string; sales?: { value: string; detail: string; floorArea?: string }[]; rentals?: { value: string; detail: string }[]; rentGrowth?: string }) {
  return emptyDeal('d', {
    property: { type: '', bedrooms: '', bathrooms: '', floorArea: opts.subjectSqFt ?? '800', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '', documents: [] },
    growth: { ...emptyDeal('x').growth, rentalGrowthPct: opts.rentGrowth ?? '' },
    salesComps: (opts.sales ?? []).map((s, i) => ({ id: 's' + i, address: 'Comp ' + i, detail: s.detail, value: s.value, floorArea: s.floorArea })),
    rentalComps: (opts.rentals ?? []).map((r, i) => ({ id: 'r' + i, address: 'RComp ' + i, detail: r.detail, value: r.value })),
    publicData: { ...emptyDeal('x').publicData, postcode: 'NG18', district: 'Mansfield', status: {}, hpi },
  });
}

describe('roundTo', () => {
  it('rounds 148,953 to 150,000 at the 5k step', () => {
    expect(roundTo(148953, 5000)).toBe(150000);
    expect(roundTo(147400, 5000)).toBe(145000);
  });
});

describe('computeGdv', () => {
  it('HPI-adjusts each comp, takes price per sqft, applies to the subject, rounds to 5k', () => {
    // Comp sold £100,000 at 2024-01 (index 100) -> adjusted x1.10 = 110,000 over 1,000 sqft = £110/sqft.
    // Subject 800 sqft -> £88,000 implied. Three identical comps -> GDV 88,000 (already on a 5k boundary).
    const deal = dealWith({
      subjectSqFt: '800',
      sales: [
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
      ],
    });
    const gdv = computeGdv(deal)!;
    expect(gdv).not.toBeNull();
    expect(gdv.comps[0].adjustedPrice).toBe(110000);
    expect(Math.round(gdv.comps[0].perSqFt)).toBe(110);
    expect(Math.round(gdv.comps[0].impliedValue)).toBe(88000);
    expect(gdv.gdv).toBe(90000); // 88,000 rounds to nearest 5k = 90,000
    expect(gdv.comps.length).toBe(3);
  });

  it('returns null with fewer than the minimum usable comps', () => {
    const deal = dealWith({
      sales: [
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
        { value: '£100,000', detail: 'Sold 2024-01' }, // no floor area -> unusable
      ],
    });
    expect(computeGdv(deal)).toBeNull();
    expect(MIN_COMPS).toBe(3);
  });

  it('returns null without a subject floor area', () => {
    const deal = dealWith({
      subjectSqFt: '',
      sales: [
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
        { value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' },
      ],
    });
    expect(computeGdv(deal)).toBeNull();
  });

  it('caps at 10 comps but still values with more entered', () => {
    const sales = Array.from({ length: 12 }, () => ({ value: '£100,000', detail: 'Sold 2024-01', floorArea: '1000' }));
    const gdv = computeGdv(dealWith({ sales }))!;
    expect(gdv.usableCount).toBe(12);
    expect(gdv.comps.length).toBe(10);
    expect(gdv.capped).toBe(true);
  });
});

describe('estimateRent', () => {
  it('uplifts a 2024 comp to the latest month by the growth assumption', () => {
    // £800 let 2024-01, 4% to 2026-06 (2.4167 yrs) -> 800 * 1.04^2.4167 ~= 880.6 -> nearest £25 = 875.
    const deal = dealWith({ rentals: [{ value: '£800 / month', detail: 'Let 2024-01' }], rentGrowth: '4' });
    const r = estimateRent(deal)!;
    expect(r.growthPctUsed).toBe(4);
    expect(r.asOfMonth).toBe('2026-06');
    expect(r.estimate).toBe(875);
  });

  it('defaults to 4% growth when none is set, and returns null with no usable comps', () => {
    expect(estimateRent(dealWith({ rentals: [{ value: '£800', detail: 'Let 2024-01' }] }))!.growthPctUsed).toBe(4);
    expect(estimateRent(dealWith({ rentals: [{ value: '£800', detail: 'no date' }] }))).toBeNull();
  });
});
