import { describe, expect, it } from 'vitest';
import { findCol } from '@/server/public-data/broadband';

describe('findCol (tolerant Ofcom header matching)', () => {
  const header = [
    'postcode_space',
    'Number of premises',
    'Maximum download speed (Mbit/s)',
    'SFBB availability (% premises)',
    'UFBB availability (% premises)',
    'Full Fibre availability (% premises)',
  ];

  it('matches postcode regardless of casing/suffix', () => {
    expect(findCol(header, 'postcode')).toBe(0);
  });

  it('matches multi-keyword columns', () => {
    expect(findCol(header, 'maximum', 'download')).toBe(2);
    expect(findCol(header, 'full fibre')).toBe(5);
    expect(findCol(header, 'sfbb', 'availability')).toBe(3);
    expect(findCol(header, 'premises')).toBe(1);
  });

  it('returns -1 when no column matches', () => {
    expect(findCol(header, 'latency')).toBe(-1);
  });
});
