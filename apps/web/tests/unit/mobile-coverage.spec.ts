import { describe, expect, it } from 'vitest';
import { atLeastOne, allFour, toNum } from '@/server/public-data/mobile-coverage';

describe('toNum', () => {
  it('parses numeric strings and strips stray characters, null on blank', () => {
    expect(toNum('12.5')).toBe(12.5);
    expect(toNum('  0 ')).toBe(0);
    expect(toNum('99%')).toBe(99);
    expect(toNum('')).toBeNull();
    expect(toNum(undefined)).toBeNull();
  });
});

describe('atLeastOne (100 - not-spot band)', () => {
  it('derives at-least-one coverage from the not-spot band', () => {
    expect(atLeastOne(true, '3.2')).toBe('96.8'); // 100 - 3.2
    expect(atLeastOne(true, '0')).toBe('100');
  });
  it('reads a blank present column as ~0 not-spot (near-total coverage)', () => {
    expect(atLeastOne(true, '')).toBe('100');
  });
  it('returns null when the column is absent', () => {
    expect(atLeastOne(false, '5')).toBeNull();
  });
});

describe('allFour (band_4 value)', () => {
  it('passes the all-four band through, rounded to 1dp', () => {
    expect(allFour(true, '81.37')).toBe('81.4');
    expect(allFour(true, '0')).toBe('0');
  });
  it('returns null for a blank or absent all-four band', () => {
    expect(allFour(true, '')).toBeNull();
    expect(allFour(false, '80')).toBeNull();
  });
});
