/**
 * Investor-criteria CSV/paste parser (BSE-OPP-P01 M1).
 *
 * Pure + client-safe: the /clients bulk-upload previews rows in the browser and
 * the server action re-parses the same text, so both must agree. Tolerant by
 * design - a partner pastes a spreadsheet column order or a headered CSV and it
 * should just work.
 *
 * Accepts either:
 *   - a headered CSV (first row names the columns; aliases below), or
 *   - headerless rows in positional order:
 *       name, budget, areas, propertyType, targetYield, strategy, notes
 *
 * Quoted fields are honoured (areas routinely contain commas, e.g.
 * "Sheffield, Rotherham"). `name` is the only required field; a row without one
 * is reported as an error, not silently dropped.
 */

export type ParsedInvestor = {
  name: string;
  budget?: string;
  areas?: string;
  propertyType?: string;
  targetYield?: string;
  strategy?: string;
  notes?: string;
};

export type ParseResult = {
  rows: ParsedInvestor[];
  errors: { line: number; reason: string }[];
};

/** Positional field order for a headerless paste. */
const POSITIONAL: (keyof ParsedInvestor)[] = [
  'name', 'budget', 'areas', 'propertyType', 'targetYield', 'strategy', 'notes',
];

/** Header-name aliases -> canonical field. Compared lower-cased, non-alnum stripped. */
const HEADER_ALIASES: Record<string, keyof ParsedInvestor> = {
  name: 'name',
  investor: 'name',
  investorname: 'name',
  client: 'name',
  clientname: 'name',
  budget: 'budget',
  maxbudget: 'budget',
  budgetmax: 'budget',
  price: 'budget',
  areas: 'areas',
  area: 'areas',
  location: 'areas',
  locations: 'areas',
  towns: 'areas',
  propertytype: 'propertyType',
  type: 'propertyType',
  proptype: 'propertyType',
  targetyield: 'targetYield',
  yield: 'targetYield',
  yieldtarget: 'targetYield',
  strategy: 'strategy',
  strat: 'strategy',
  notes: 'notes',
  note: 'notes',
  comment: 'notes',
  comments: 'notes',
};

/** Normalise a header cell to its alias key ("Target Yield" -> "targetyield"). */
function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Split one CSV line into fields, honouring double-quoted cells (with ""
 * escaping a literal quote inside a quoted cell). Not multi-line aware - a
 * quoted newline is out of scope for a pasted brief list.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Is the first row a header? True when its first cell aliases to a known field. */
function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => HEADER_ALIASES[headerKey(c)] !== undefined)
    && HEADER_ALIASES[headerKey(cells[0])] !== undefined;
}

/** Trim to undefined-if-empty. */
function clean(s: string | undefined): string | undefined {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Parse pasted CSV/spreadsheet text into investor rows. Blank lines are ignored;
 * a row missing a name is reported in `errors` with its 1-based source line.
 */
export function parseInvestorCsv(text: string): ParseResult {
  const result: ParseResult = { rows: [], errors: [] };
  if (typeof text !== 'string' || text.trim().length === 0) return result;

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');

  // Find the first non-empty line to decide header vs positional.
  let firstIdx = rawLines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return result;

  let columns = POSITIONAL;
  const firstCells = splitCsvLine(rawLines[firstIdx]);
  if (looksLikeHeader(firstCells)) {
    columns = firstCells.map((c) => HEADER_ALIASES[headerKey(c)] ?? ('__ignore__' as keyof ParsedInvestor));
    firstIdx += 1; // skip the header row
  }

  for (let i = firstIdx; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim().length === 0) continue;

    const cells = splitCsvLine(line);
    const row: Partial<ParsedInvestor> = {};
    for (let col = 0; col < cells.length; col++) {
      const field = columns[col];
      if (!field || field === ('__ignore__' as keyof ParsedInvestor)) continue;
      const value = clean(cells[col]);
      if (value !== undefined) row[field] = value;
    }

    if (!row.name) {
      result.errors.push({ line: i + 1, reason: 'Missing investor name.' });
      continue;
    }
    result.rows.push(row as ParsedInvestor);
  }

  return result;
}
