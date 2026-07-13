import { describe, expect, it } from 'vitest';
import { parseInvestorCsv } from '@/lib/investor-csv';

/**
 * Investor-criteria CSV/paste parser (BSE-OPP-P01 M1, AC-03 bulk upload). The
 * /clients preview and the server import re-parse the same text, so this must be
 * tolerant (header or positional, quoted commas) and must never silently drop a
 * nameless row - it reports it.
 */

describe('parseInvestorCsv', () => {
  it('parses a headered CSV, honouring quoted commas in areas', () => {
    const text = [
      'name,budget,areas,propertyType,targetYield,strategy,notes',
      'J. Patel,£350000,"Sheffield, Rotherham",Terraced,7%,BTL,cash buyer',
    ].join('\n');
    const { rows, errors } = parseInvestorCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'J. Patel',
      budget: '£350000',
      areas: 'Sheffield, Rotherham',
      propertyType: 'Terraced',
      targetYield: '7%',
      strategy: 'BTL',
      notes: 'cash buyer',
    });
  });

  it('maps header aliases (Investor / Location / Yield / Type)', () => {
    const text = [
      'Investor,Location,Type,Yield',
      'K. Shah,Mansfield,Semi,8%',
    ].join('\n');
    const { rows } = parseInvestorCsv(text);
    expect(rows[0]).toMatchObject({
      name: 'K. Shah', areas: 'Mansfield', propertyType: 'Semi', targetYield: '8%',
    });
  });

  it('reads headerless rows positionally', () => {
    const { rows } = parseInvestorCsv('A. Byrne, 250k, Doncaster, Detached, 6%');
    expect(rows[0]).toMatchObject({
      name: 'A. Byrne', budget: '250k', areas: 'Doncaster', propertyType: 'Detached', targetYield: '6%',
    });
  });

  it('reports a row missing a name instead of dropping it silently', () => {
    const text = [
      'name,budget',
      ',£100000',
      'Valid,£200000',
    ].join('\n');
    const { rows, errors } = parseInvestorCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Valid');
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2); // 1-based source line of the bad row
  });

  it('ignores blank lines and trims cells', () => {
    const text = '\n  J. Patel ,  £300000  \n\n';
    const { rows } = parseInvestorCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'J. Patel', budget: '£300000' });
  });

  it('returns empty for empty input', () => {
    expect(parseInvestorCsv('')).toEqual({ rows: [], errors: [] });
    expect(parseInvestorCsv('   \n  ')).toEqual({ rows: [], errors: [] });
  });

  it('escapes doubled quotes inside a quoted cell', () => {
    const { rows } = parseInvestorCsv('name,notes\nJ. Patel,"say ""hi"" to them"');
    expect(rows[0].notes).toBe('say "hi" to them');
  });
});
