import { describe, expect, it } from 'vitest';
import { parseCsvLine, INGEST_POSTCODE_AREAS } from '@/server/public-data/land-ownership';

describe('parseCsvLine (CCOD/OCOD CSV parsing)', () => {
  it('parses a simple row', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted fields (e.g. addresses)', () => {
    expect(parseCsvLine('"12 High Street, Mansfield",NG18 1AB')).toEqual(['12 High Street, Mansfield', 'NG18 1AB']);
  });

  it('handles escaped double-quotes ("")', () => {
    expect(parseCsvLine('"The ""Old"" Mill",X')).toEqual(['The "Old" Mill', 'X']);
  });

  it('preserves empty fields, including a trailing one', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('handles a realistic CCOD-style line', () => {
    const line = '"NG123456","Freehold","1 Test Road, Worksop","Bassetlaw","Notts","East Midlands","S80 1AA","","250000","ACME PROPERTIES LTD","01234567","Limited Company or PLC","UK"';
    const cols = parseCsvLine(line);
    expect(cols[0]).toBe('NG123456');
    expect(cols[6]).toBe('S80 1AA');
    expect(cols[9]).toBe('ACME PROPERTIES LTD');
    expect(cols[10]).toBe('01234567');
  });
});

describe('INGEST_POSTCODE_AREAS', () => {
  it('defaults to Bullseye operating areas and is non-empty', () => {
    expect(INGEST_POSTCODE_AREAS.length).toBeGreaterThan(0);
    expect(INGEST_POSTCODE_AREAS).toContain('NG');
    expect(INGEST_POSTCODE_AREAS).toContain('S');
  });
});
