import { describe, expect, it } from 'vitest';
import { parseCsvLine, INGEST_POSTCODE_AREAS, resolveColumns } from '@/server/public-data/land-ownership';

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

describe('resolveColumns (tolerant CCOD/OCOD header matching)', () => {
  // The documented CCOD header.
  const ccod = [
    'Title Number', 'Tenure', 'Property Address', 'District', 'County', 'Region',
    'Postcode', 'Multiple Address Indicator', 'Price Paid',
    'Proprietor Name (1)', 'Company Registration No. (1)', 'Proprietorship Category (1)', 'Country Incorporated (1)',
    'Proprietor (1) Address (1)',
    'Proprietor Name (2)', 'Company Registration No. (2)', 'Proprietorship Category (2)', 'Country Incorporated (2)',
  ];

  it('resolves the key columns by keyword', () => {
    const r = resolveColumns(ccod);
    expect(r.postcode).toBe(6);
    expect(r.title).toBe(0);
    expect(r.tenure).toBe(1);
    expect(r.address).toBe(2);
    expect(r.pricePaid).toBe(8);
    expect(r.names[0]).toBe(9);
    expect(r.names[1]).toBe(14);
    expect(r.regs[0]).toBe(10);
  });

  it('still resolves postcode under different casing/spacing', () => {
    expect(resolveColumns(['Title No', ' POSTCODE ', 'Price Paid']).postcode).toBe(1);
  });

  it('returns -1 for postcode when truly absent (signals a bad/garbled header)', () => {
    expect(resolveColumns(['col-a', 'col-b']).postcode).toBe(-1);
  });
});

describe('INGEST_POSTCODE_AREAS', () => {
  it('defaults to Bullseye operating areas and is non-empty', () => {
    expect(INGEST_POSTCODE_AREAS.length).toBeGreaterThan(0);
    expect(INGEST_POSTCODE_AREAS).toContain('NG');
    expect(INGEST_POSTCODE_AREAS).toContain('S');
  });
});
