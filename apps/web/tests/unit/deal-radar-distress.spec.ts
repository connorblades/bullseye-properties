import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  gazetteNoticeType,
  normaliseGazetteFeed,
  fetchGazetteInsolvency,
  indexGazetteEvents,
  normalisePsc,
  fetchPsc,
  buildPscPortfolio,
  deceasedEstatesEnabled,
  fetchGazetteDeceasedEstates,
  normaliseDeceasedFeed,
  type CompanyPscInput,
} from '@/server/deal-radar/distress-sources';
import {
  buildAreaWeightTable,
  areaMultiplierFor,
  isEmptyHomesHotspot,
  normaliseLaName,
  type TaxbaseRow,
} from '@/server/deal-radar/area-weights';
import { scoreDwelling, type CohortModel, type DwellingInput } from '@/server/deal-radar/score';

// A minimal cohort model so scoreDwelling is exercised in isolation.
function model(over: Partial<CohortModel> = {}): CohortModel {
  return {
    ppsqftByCohort: new Map([['S80|T', 1500]]),
    ppsqftByDistrict: new Map([['S80', 1500]]),
    cellRate: new Map(),
    cohortRate: new Map([['S80|T', { n: 50, rate: 0.3, depth: 0.2 }]]),
    ...over,
  };
}

const baseDwelling = (over: Partial<DwellingInput> = {}): DwellingInput => ({
  address: '12 TEST STREET, WORKSOP',
  postcode: 'S80 2AB',
  district: 'S80',
  ptype: 'T',
  epc: 'C',
  epcGroup: 'ABC',
  floorArea: 80,
  ...over,
});

// ── Gazette insolvency client ────────────────────────────────────────────────

describe('Gazette insolvency: notice-type classification', () => {
  it('maps titles/categories to a short notice type', () => {
    expect(gazetteNoticeType('Notice of winding-up order', '')).toBe('winding-up');
    expect(gazetteNoticeType('Appointment of administrators', '')).toBe('administration');
    expect(gazetteNoticeType('Notice to creditors', 'strike-off / dissolution')).toBe('strike-off');
    expect(gazetteNoticeType('Members voluntary liquidation', '')).toBe('liquidation');
    expect(gazetteNoticeType('Some unrecognised notice', '')).toBe('insolvency notice');
  });
});

describe('Gazette insolvency: feed normalisation', () => {
  const feed = {
    entry: [
      {
        title: 'ACME PROPERTIES LTD (company number 09876543) winding-up order, S80 1AA',
        published: '2026-06-25T00:00:00Z',
        category: { term: 'insolvency', label: 'Winding up' },
      },
      { title: 'No date, no number administration notice, DN11 8QP' },
    ],
  };

  it('extracts company number, notice type, postcode and days-since', () => {
    const events = normaliseGazetteFeed(feed, '2026-07-07T00:00:00Z');
    expect(events).toHaveLength(2);
    expect(events[0].companyNumber).toBe('09876543');
    expect(events[0].noticeType).toBe('winding-up');
    expect(events[0].noticePostcode).toBe('S80 1AA');
    expect(events[0].daysSinceEvent).toBe(12);
    // Second entry: no company number, still typed + postcode-tagged.
    expect(events[1].companyNumber).toBeUndefined();
    expect(events[1].noticeType).toBe('administration');
    expect(events[1].noticePostcode).toBe('DN11 8QP');
    expect(events[1].daysSinceEvent).toBeUndefined();
  });

  it('indexes events by company_number and by exact notice postcode', () => {
    const idx = indexGazetteEvents(normaliseGazetteFeed(feed, '2026-07-07T00:00:00Z'));
    expect(idx.byCompany.get('09876543')?.noticeType).toBe('winding-up');
    expect(idx.byPostcode.get('S80 1AA')?.noticeType).toBe('winding-up');
    expect(idx.byPostcode.get('DN11 8QP')?.noticeType).toBe('administration');
    // The exact postcode does not leak to other doors in the same district.
    expect(idx.byPostcode.get('S80 9ZZ')).toBeUndefined();
  });

  it('keeps the most recent event when a key repeats', () => {
    const idx = indexGazetteEvents([
      { noticeType: 'winding-up', companyNumber: '00000001', daysSinceEvent: 40, publishedDate: '2026-05-01' },
      { noticeType: 'administration', companyNumber: '00000001', daysSinceEvent: 5, publishedDate: '2026-07-01' },
    ]);
    expect(idx.byCompany.get('00000001')?.noticeType).toBe('administration');
  });
});

describe('Gazette insolvency: fail-soft', () => {
  it('a fixture feed is parsed without any network call', async () => {
    const events = await fetchGazetteInsolvency({
      postcode: 'S80 1AA',
      asOf: '2026-07-07T00:00:00Z',
      fixture: { entry: [{ title: 'BETA LTD (09876543) receivership, S80 1AA', published: '2026-07-01' }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0].noticeType).toBe('receivership');
  });

  it('a transport that throws degrades to an empty list (never throws)', async () => {
    const events = await fetchGazetteInsolvency({
      postcode: 'S80 1AA',
      transport: async () => {
        throw new Error('gazette 503');
      },
    });
    expect(events).toEqual([]);
  });
});

// ── Companies House PSC ──────────────────────────────────────────────────────

describe('Companies House PSC', () => {
  it('normalises active control persons and drops ceased ones', () => {
    const persons = normalisePsc('09876543', {
      items: [
        { name: 'Jane Doe', kind: 'individual-person-with-significant-control' },
        { name: 'Ceased Person', ceased_on: '2024-01-01' },
      ],
    });
    expect(persons).toHaveLength(1);
    expect(persons[0].name).toBe('Jane Doe');
    expect(persons[0].companyNumber).toBe('09876543');
  });

  it('fetchPsc returns [] with no API key configured (fail-soft)', async () => {
    const prev = process.env.COMPANIES_HOUSE_API_KEY;
    delete process.env.COMPANIES_HOUSE_API_KEY;
    try {
      expect(await fetchPsc('09876543')).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.COMPANIES_HOUSE_API_KEY = prev;
    }
  });

  it('a fixture response is parsed without any network call', async () => {
    const persons = await fetchPsc('09876543', { fixture: { items: [{ name: 'Jane Doe' }] } });
    expect(persons[0].name).toBe('Jane Doe');
  });
});

describe('PSC portfolio rollup (pure)', () => {
  it('counts distressed companies per controlling person and picks the approach target', () => {
    const companies: CompanyPscInput[] = [
      { companyNumber: 'C1', distressed: true, pscNames: ['Jane Doe'] },
      { companyNumber: 'C2', distressed: true, pscNames: ['jane  doe'] }, // same person, noisy casing/spacing
      { companyNumber: 'C3', distressed: true, pscNames: ['Jane Doe', 'Other Person'] },
      { companyNumber: 'C4', distressed: false, pscNames: ['Jane Doe'] }, // not distressed: excluded from the count
    ];
    const portfolio = buildPscPortfolio(companies);
    // Jane Doe controls three DISTRESSED companies (C1, C2, C3); C4 does not count.
    expect(portfolio.get('C1')?.controlsDistressed).toBe(3);
    expect(portfolio.get('C1')?.pscName).toBe('Jane Doe');
    // A non-distressed company still gets its controller's distressed-portfolio size.
    expect(portfolio.get('C4')?.controlsDistressed).toBe(3);
    // "Other Person" only controls one distressed company, so C3's target is Jane Doe.
    expect(portfolio.get('C3')?.pscName).toBe('Jane Doe');
  });

  it('a lone distressed company yields a portfolio count of 1 (below the route threshold)', () => {
    const portfolio = buildPscPortfolio([{ companyNumber: 'C1', distressed: true, pscNames: ['Solo Owner'] }]);
    expect(portfolio.get('C1')?.controlsDistressed).toBe(1);
  });
});

// ── Deceased-estates GDPR gate ───────────────────────────────────────────────

describe('Gazette deceased-estates: GDPR gate is OFF by default', () => {
  const prev = process.env.RDR_ENABLE_DECEASED_ESTATES;
  beforeEach(() => {
    delete process.env.RDR_ENABLE_DECEASED_ESTATES;
  });
  afterEach(() => {
    if (prev !== undefined) process.env.RDR_ENABLE_DECEASED_ESTATES = prev;
    else delete process.env.RDR_ENABLE_DECEASED_ESTATES;
  });

  it('deceasedEstatesEnabled() is false unless explicitly set to "true"', () => {
    expect(deceasedEstatesEnabled()).toBe(false);
    process.env.RDR_ENABLE_DECEASED_ESTATES = 'false';
    expect(deceasedEstatesEnabled()).toBe(false);
    process.env.RDR_ENABLE_DECEASED_ESTATES = 'true';
    expect(deceasedEstatesEnabled()).toBe(true);
  });

  it('the fetcher returns [] AND makes no request while gated off, even with a fixture present', async () => {
    let transportCalled = false;
    const events = await fetchGazetteDeceasedEstates({
      postcode: 'S80 1AA',
      fixture: { entry: [{ title: 'Estate of A.N. Other deceased, S80 1AA', published: '2026-07-01' }] },
      transport: async () => {
        transportCalled = true;
        return { entry: [] };
      },
    });
    expect(events).toEqual([]); // no person-level data ingested in the default path
    expect(transportCalled).toBe(false);
  });

  it('once the gate is opened, it parses (and remains fail-soft on failure)', async () => {
    process.env.RDR_ENABLE_DECEASED_ESTATES = 'true';
    const parsed = await fetchGazetteDeceasedEstates({
      postcode: 'S80 1AA',
      asOf: '2026-07-07T00:00:00Z',
      fixture: { entry: [{ title: 'Estate of A.N. Other, deceased, S80 1AA', published: '2026-07-01' }] },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].noticePostcode).toBe('S80 1AA');

    const failed = await fetchGazetteDeceasedEstates({
      postcode: 'S80 1AA',
      transport: async () => {
        throw new Error('gazette down');
      },
    });
    expect(failed).toEqual([]);
  });

  it('normaliseDeceasedFeed shapes a person-level notice (used only when gated on)', () => {
    const [ev] = normaliseDeceasedFeed(
      { entry: [{ title: 'Estate of John Smith, deceased, S80 1AA', published: '2026-07-01' }] },
      '2026-07-07T00:00:00Z'
    );
    expect(ev.deceasedName).toBe('Estate of John Smith');
    expect(ev.daysSinceEvent).toBe(6);
  });
});

// ── Council Taxbase empty-homes area weights ─────────────────────────────────

describe('area weights: Council Taxbase empty-homes premium', () => {
  const rows: TaxbaseRow[] = [
    { localAuthority: 'Bassetlaw', dwellings: 50000, longTermEmpty: 500, premiumCharged: 200 }, // 1.0% empty
    { localAuthority: 'Rotherham', dwellings: 100000, longTermEmpty: 1000, premiumCharged: 400 }, // 1.0% empty (median)
    { localAuthority: 'Bolsover', dwellings: 30000, longTermEmpty: 900, premiumCharged: 500 }, // 3.0% empty (hotspot)
  ];

  it('lifts the multiplier for above-median empty-homes overhang and flags a hotspot', () => {
    const table = buildAreaWeightTable(rows);
    expect(areaMultiplierFor(table, 'Bassetlaw')).toBe(1); // at median -> neutral
    expect(isEmptyHomesHotspot(table, 'Bassetlaw')).toBe(false);
    // Bolsover: 3x the median empty rate -> lifted and a hotspot.
    expect(areaMultiplierFor(table, 'Bolsover')).toBeGreaterThan(1);
    expect(isEmptyHomesHotspot(table, 'Bolsover')).toBe(true);
  });

  it('never lifts below 1.0 and respects the cap', () => {
    const table = buildAreaWeightTable(rows, { maxMultiplier: 1.2 });
    expect(areaMultiplierFor(table, 'Bolsover')).toBeLessThanOrEqual(1.2);
    for (const la of ['Bassetlaw', 'Rotherham', 'Bolsover']) {
      expect(areaMultiplierFor(table, la)).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns neutral defaults for unknown LAs and an empty table', () => {
    const table = buildAreaWeightTable(rows);
    expect(areaMultiplierFor(table, 'Nowhere')).toBe(1);
    expect(areaMultiplierFor(table, undefined)).toBe(1);
    expect(isEmptyHomesHotspot(table, 'Nowhere')).toBe(false);
    const empty = buildAreaWeightTable([]);
    expect(areaMultiplierFor(empty, 'Bassetlaw')).toBe(1);
  });

  it('normaliseLaName is case- and whitespace-insensitive', () => {
    const table = buildAreaWeightTable(rows);
    expect(areaMultiplierFor(table, '  bolsover ')).toBe(areaMultiplierFor(table, 'Bolsover'));
    expect(normaliseLaName('  North  East   Derbyshire ')).toBe('NORTH EAST DERBYSHIRE');
  });
});

// ── Score integration: the M10 signals contribute + change the score ─────────

describe('scoreDwelling with M10 signals', () => {
  it('the empty-homes area weight raises the confidence versus a neutral area', () => {
    const neutral = scoreDwelling(baseDwelling(), model());
    const hotspot = scoreDwelling(baseDwelling({ areaMultiplier: 1.3, areaHotspot: true }), model());
    // Same dwelling, heavier empty-homes overhang -> a higher motivated-seller score.
    expect(hotspot.confidence).toBeGreaterThan(neutral.confidence);
    expect(hotspot.reasons).toContain('empty-homes hotspot LA');
  });

  it('renders the Gazette forced-sale reason with type and days-since, ranked first', () => {
    const s = scoreDwelling(
      baseDwelling({ gazetteEvent: true, gazetteNoticeType: 'winding-up', gazetteDaysSince: 12 }),
      model()
    );
    expect(s.reasons[0]).toBe('Gazette winding-up 12 days ago');
  });

  it('a Gazette event lifts the score above the clean baseline', () => {
    const clean = scoreDwelling(baseDwelling(), model());
    const gazette = scoreDwelling(baseDwelling({ gazetteEvent: true, gazetteNoticeType: 'administration' }), model());
    expect(gazette.confidence).toBeGreaterThan(clean.confidence);
    expect(gazette.reasons).toContain('Gazette administration');
  });

  it('renders the PSC portfolio reason only at 2+ distressed companies', () => {
    const one = scoreDwelling(baseDwelling({ pscControlsDistressed: 1 }), model());
    expect(one.reasons.some((r) => r.startsWith('PSC controls'))).toBe(false);
    const three = scoreDwelling(baseDwelling({ pscControlsDistressed: 3 }), model());
    expect(three.reasons).toContain('PSC controls 3 distressed cos');
    expect(three.confidence).toBeGreaterThan(one.confidence);
  });

  it('does not disturb the existing reason order when no M10 signals are present', () => {
    const s = scoreDwelling(baseDwelling({ epc: 'F', epcGroup: 'FG', insolvent: true, ownerStatus: 'LIQUIDATION' }), model());
    expect(s.reasons).toEqual([
      'OWNER INSOLVENT (LIQUIDATION)',
      'EPC F severe/MEES',
      'cohort 30.0% sell 15%+ under',
    ]);
  });
});
