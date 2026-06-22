import { describe, expect, it } from 'vitest';
import { emptyDeal } from '@/lib/deal-store';

/**
 * Regression tests for the emptyDeal deep-merge (the fix for the live Stage 10
 * crash, where a deal rebuilt from partial stored `growth` lost `drivers` and
 * `.map()` threw).
 */
describe('emptyDeal deep-merge', () => {
  it('keeps default growth.drivers when initial.growth omits them', () => {
    const d = emptyDeal('d', { growth: { capitalGrowthPct: '5' } as never });
    expect(Array.isArray(d.growth.drivers)).toBe(true);
    expect(d.growth.drivers.length).toBeGreaterThan(0);
    // explicit field still applied
    expect(d.growth.capitalGrowthPct).toBe('5');
    // other growth defaults preserved
    expect(d.growth.ltvPct).toBe('75');
  });

  it('keeps viewing defaults (photos array, ratings) when initial.viewing is partial', () => {
    const d = emptyDeal('d', { viewing: { notes: 'damp in rear room' } as never });
    expect(d.viewing.photos).toEqual([]);
    expect(d.viewing.roof).toBe('');
    expect(d.viewing.notes).toBe('damp in rear room');
  });

  it('keeps nested defaults across criteria/property/financials/offer when partial', () => {
    const d = emptyDeal('d', {
      criteria: { budget: '£300k' } as never,
      property: { type: 'Semi' } as never,
      financials: { purchasePrice: '250000' } as never,
    });
    expect(d.criteria.areas).toBe('');
    expect(d.property.documents).toEqual([]);
    expect(d.financials.monthlyRent).toBe('');
    expect(d.offer.recommended).toBe('');
  });

  it('still applies top-level fields and full nested objects', () => {
    const d = emptyDeal('d', { address: '1 Test St', progress: 9, delivered: true });
    expect(d.address).toBe('1 Test St');
    expect(d.progress).toBe(9);
    expect(d.delivered).toBe(true);
  });
});
