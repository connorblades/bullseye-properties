import { describe, expect, it } from 'vitest';
import {
  validateCandidate,
  validateCandidateBatch,
  FEEDER_CONTRACT_VERSION,
  LEAD_CHANNELS,
} from '@/lib/feeder-contract';

/**
 * Feeder -> ingress contract validation (M2). address + channel are the hard
 * contract; everything else is best-effort and only type-checked when present.
 */

describe('validateCandidate', () => {
  it('accepts a well-formed Rightmove/portal listing', () => {
    const r = validateCandidate({ address: '12 A St, Worksop', channel: 'portal', askingPrice: 120000 });
    expect(r.ok).toBe(true);
  });

  it('accepts a well-formed auction/EIG lot', () => {
    const r = validateCandidate({ address: '12 A St, Worksop', channel: 'auction', guidePrice: 90000 });
    expect(r.ok).toBe(true);
  });

  it('rejects a missing address', () => {
    const r = validateCandidate({ channel: 'portal' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('address');
  });

  it('rejects a bad channel and names the allowed set', () => {
    const r = validateCandidate({ address: '12 A St', channel: 'bogus' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain(LEAD_CHANNELS.join(', '));
  });

  it('rejects a wrong-typed numeric and a bad market', () => {
    const r = validateCandidate({ address: '12 A St', channel: 'portal', guidePrice: 'cheap', market: 'sold' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join()).toContain('guidePrice');
      expect(r.errors.join()).toContain('market');
    }
  });

  it('rejects a non-object', () => {
    expect(validateCandidate(null).ok).toBe(false);
    expect(validateCandidate('nope').ok).toBe(false);
    expect(validateCandidate([]).ok).toBe(false);
  });
});

describe('validateCandidateBatch', () => {
  it('partitions accepted and rejected items, preserving indices', () => {
    const { valid, invalid } = validateCandidateBatch([
      { address: '1 Good St', channel: 'portal' },
      { channel: 'auction' }, // missing address
      { address: '3 Also Good', channel: 'auction', guidePrice: 80000 },
      { address: '4 Bad Channel', channel: 'nope' },
    ]);
    expect(valid).toHaveLength(2);
    expect(invalid.map((i) => i.index)).toEqual([1, 3]);
    expect(invalid[0].address).toBe('(unknown)');
    expect(invalid[1].address).toBe('4 Bad Channel');
  });
});

describe('contract version', () => {
  it('is a stable date string feeders can pin', () => {
    expect(FEEDER_CONTRACT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
