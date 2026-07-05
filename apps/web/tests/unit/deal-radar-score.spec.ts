import { describe, expect, it } from 'vitest';
import {
  median,
  round5k,
  computeCohortBaseRate,
  scoreDwelling,
  dwellingToCandidate,
  epcGroupOf,
  ptypeOf,
  leadingNumber,
  propertyTypeLabel,
  type SoldObservation,
  type CohortModel,
  type DwellingInput,
} from '@/server/deal-radar/score';

// A minimal model builder for scoreDwelling tests (isolates the noisy-OR from
// the learning pass). One cohort, no cell override unless asked.
function model(over: Partial<CohortModel> = {}): CohortModel {
  return {
    ppsqftByCohort: new Map([['S80|T', 1500]]),
    ppsqftByDistrict: new Map([['S80', 1500]]),
    cellRate: new Map(),
    cohortRate: new Map([['S80|T', { n: 5, rate: 0.3, depth: 0.2 }]]),
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

describe('helpers', () => {
  it('median: odd and even length', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('round5k rounds to the nearest 5,000', () => {
    expect(round5k(120000)).toBe(120000);
    expect(round5k(122499)).toBe(120000);
    expect(round5k(122500)).toBe(125000);
    expect(round5k(96000)).toBe(95000);
  });

  it('epcGroupOf classifies bands', () => {
    expect(epcGroupOf('f')).toBe('FG');
    expect(epcGroupOf('G')).toBe('FG');
    expect(epcGroupOf('D')).toBe('DE');
    expect(epcGroupOf('E')).toBe('DE');
    expect(epcGroupOf('B')).toBe('ABC');
    expect(epcGroupOf('')).toBe('UNK');
  });

  it('ptypeOf maps EPC property type + built form to a Land Registry code', () => {
    expect(ptypeOf('Flat', 'Enclosed Mid-Terrace')).toBe('F');
    expect(ptypeOf('Maisonette', '')).toBe('F');
    expect(ptypeOf('House', 'Detached')).toBe('D');
    expect(ptypeOf('House', 'Semi-Detached')).toBe('S');
    expect(ptypeOf('House', 'Mid-Terrace')).toBe('T');
    expect(ptypeOf('House', 'NODATA')).toBeNull();
  });

  it('leadingNumber pulls the paon house number', () => {
    expect(leadingNumber('12A HIGH STREET')).toBe('12');
    expect(leadingNumber('FLAT 3, THE MALTINGS')).toBe('');
  });

  it('propertyTypeLabel is human-readable', () => {
    expect(propertyTypeLabel('F')).toBe('Flat');
    expect(propertyTypeLabel('S')).toBe('Semi-detached');
  });
});

describe('computeCohortBaseRate', () => {
  // 4 same-cohort sales; n<30 so no cohort ppsqft, district median is used.
  const sold: SoldObservation[] = [
    { district: 'S80', ptype: 'T', epcGroup: 'DE', floorArea: 100, price: 100000 },
    { district: 'S80', ptype: 'T', epcGroup: 'DE', floorArea: 100, price: 100000 },
    { district: 'S80', ptype: 'T', epcGroup: 'DE', floorArea: 100, price: 50000 },
    { district: 'S80', ptype: 'T', epcGroup: 'DE', floorArea: 100, price: 150000 },
  ];

  it('learns district price-per-sqft (median) when the cohort is under-sampled', () => {
    const m = computeCohortBaseRate(sold);
    expect(m.ppsqftByCohort.size).toBe(0); // n<30
    expect(m.ppsqftByDistrict.get('S80')).toBe(1000); // median of [500,1000,1000,1500]
  });

  it('computes cohort discount rate + median depth vs the size-normalised value', () => {
    const m = computeCohortBaseRate(sold);
    const cohort = m.cohortRate.get('S80|T');
    // refValue = 100 * 1000 = 100000; only the 50000 sale is <= 85% of it.
    expect(cohort).toEqual({ n: 4, rate: 0.25, depth: 0.5 });
    const cell = m.cellRate.get('S80|T|DE');
    expect(cell).toEqual({ n: 4, rate: 0.25, depth: 0.5 });
  });

  it('prefers the cell rate over the cohort rate once the cell is well-sampled', () => {
    // 20 fully-discounted DE sales + 20 never-discounted ABC sales in one cohort.
    const many: SoldObservation[] = [];
    for (let i = 0; i < 20; i++) many.push({ district: 'S80', ptype: 'T', epcGroup: 'DE', floorArea: 100, price: 40000 });
    for (let i = 0; i < 20; i++) many.push({ district: 'S80', ptype: 'T', epcGroup: 'ABC', floorArea: 100, price: 100000 });
    const m = computeCohortBaseRate(many);
    // district ppsqft = median of [400 x20, 1000 x20] = (400+1000)/2 = 700.
    expect(m.ppsqftByDistrict.get('S80')).toBe(700);
    // DE cell: refValue 100*700=70000; 40000 <= 0.85*70000=59500 -> all discounted.
    const de = m.cellRate.get('S80|T|DE');
    expect(de?.n).toBe(20);
    expect(de?.rate).toBe(1);
    // A DE dwelling then scores off the cell rate (1.0, capped to 0.6), not the
    // blended cohort rate (0.5).
    const s = scoreDwelling(baseDwelling({ epc: 'E', epcGroup: 'DE', floorArea: 100 }), m);
    expect(s.baseRate).toBe(1);
    expect(s.reasons.at(-1)).toBe('cohort 100.0% sell 15%+ under');
  });
});

describe('scoreDwelling noisy-OR', () => {
  it('a clean dwelling scores its capped base rate only', () => {
    const s = scoreDwelling(baseDwelling(), model());
    // base 0.3 -> confidence 0.3 (no signals).
    expect(s.confidence).toBe(0.3);
    expect(s.reasons).toEqual(['cohort 30.0% sell 15%+ under']);
  });

  it('combines independent routes multiplicatively and caps the base rate at 0.6', () => {
    const s = scoreDwelling(
      baseDwelling({ epc: 'F', epcGroup: 'FG', companyOwned: true, insolvent: true, ownerStatus: 'LIQUIDATION' }),
      model({ cohortRate: new Map([['S80|T', { n: 5, rate: 0.3, depth: 0.2 }]]) })
    );
    // survive = 0.7 * 0.75(FG) * 0.88(company) * 0.60(insolvent) = 0.2772
    expect(s.confidence).toBe(0.7228);
  });

  it('ranks reasons strongest-first and renders the proof wording', () => {
    const s = scoreDwelling(
      baseDwelling({
        epc: 'F',
        epcGroup: 'FG',
        tenure: 'rental (private)',
        companyOwned: true,
        insolvent: true,
        ownerStatus: 'IN ADMINISTRATION',
        accountsOverdue: true,
        dormant: true,
        hasCharges: true,
        streetDisc: 0.7,
        churned: true,
      }),
      model()
    );
    expect(s.reasons).toEqual([
      'OWNER INSOLVENT (IN ADMINISTRATION)',
      'owner accounts overdue',
      'owner company dormant',
      'owner has secured debt',
      'EPC F severe/MEES',
      'company owned',
      'landlord/BTL',
      'hot street 70%',
      'repeat-sold',
      'cohort 30.0% sell 15%+ under',
    ]);
  });

  it('prefers overseas-company then property-company then plain company wording', () => {
    const overseas = scoreDwelling(baseDwelling({ companyOwned: true, isOverseas: true }), model());
    expect(overseas.reasons).toContain('overseas-company owned');
    const propco = scoreDwelling(baseDwelling({ companyOwned: true, propertySic: true }), model());
    expect(propco.reasons).toContain('property-company owned');
    const plain = scoreDwelling(baseDwelling({ companyOwned: true }), model());
    expect(plain.reasons).toContain('company owned');
  });

  it('loss-resale outranks and replaces a plain churn flag', () => {
    const s = scoreDwelling(baseDwelling({ churned: true, resoldLoss: true }), model());
    expect(s.reasons).toContain('prior loss-resale');
    expect(s.reasons).not.toContain('repeat-sold');
  });

  it('confidence always lands in [0,1]', () => {
    const s = scoreDwelling(
      baseDwelling({
        epc: 'G',
        epcGroup: 'FG',
        companyOwned: true,
        isOverseas: true,
        tenure: 'rental (private)',
        insolvent: true,
        strikeOff: true,
        accountsOverdue: true,
        confstmtOverdue: true,
        dormant: true,
        hasCharges: true,
        resoldLoss: true,
        streetDisc: 1,
      }),
      model({ cohortRate: new Map([['S80|T', { n: 100, rate: 0.6, depth: 0.4 }]]) })
    );
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
  });
});

describe('value estimates', () => {
  it('HPI-adjusts and rounds market value + achievable to the nearest 5,000', () => {
    // ppsqft 1500 x 80sqm = 120000; depth 0.2 -> achievable 96000 -> 95000.
    const s = scoreDwelling(baseDwelling({ floorArea: 80 }), model());
    expect(s.estMarketValue).toBe(120000);
    expect(s.estAchievable).toBe(95000);
  });

  it('applies the HPI factor before rounding', () => {
    const s = scoreDwelling(baseDwelling({ floorArea: 80 }), model(), { hpiFactor: 1.04 });
    // 120000 * 1.04 = 124800 -> round5k 125000.
    expect(s.estMarketValue).toBe(125000);
  });

  it('yields zero value when no price-per-sqft is learned for the cohort', () => {
    const empty = model({ ppsqftByCohort: new Map(), ppsqftByDistrict: new Map() });
    const s = scoreDwelling(baseDwelling(), empty);
    expect(s.estMarketValue).toBe(0);
    expect(s.estAchievable).toBe(0);
  });
});

describe('dwellingToCandidate (emit contract)', () => {
  it('produces an open-data ScrapedCandidate carrying the radar block', () => {
    const d = baseDwelling({ ptype: 'F', epc: 'F', epcGroup: 'FG', tenure: 'rental (private)', uprn: '100012345' });
    const score = scoreDwelling(d, model());
    const c = dwellingToCandidate(d, score, { run: 'run-1', capturedAt: '2026-07-05T09:00:00.000Z' });
    expect(c.channel).toBe('open-data');
    expect(c.propertyType).toBe('Flat');
    expect(c.epcRating).toBe('F');
    expect(c.askingPrice).toBeUndefined();
    expect(c.guidePrice).toBeUndefined();
    expect(c.sourceRef).toBe('rdr:run-1:100012345');
    expect(c.capturedAt).toBe('2026-07-05T09:00:00.000Z');
    expect(c.radar?.discountConfidence).toBe(score.confidence);
    expect(c.radar?.discountReasons).toEqual(score.reasons);
    expect(c.radar?.estMarketValue).toBe(score.estMarketValue);
    expect(c.radar?.estAchievable).toBe(score.estAchievable);
  });

  it('falls back to postcode:address for sourceRef when there is no UPRN', () => {
    const d = baseDwelling();
    const c = dwellingToCandidate(d, scoreDwelling(d, model()), { run: 'r', capturedAt: '' });
    expect(c.sourceRef).toBe('rdr:r:S80 2AB:12 TEST STREET, WORKSOP');
  });
});

describe('golden proof row (reason parity vs Deal_Radar_Prospects_CorePatch_FULL.csv row 1)', () => {
  // CSV row 1: "1, CHURCH STREET, SWINTON", F, EPC D, cohort 88%, distress.
  // reasons: OWNER INSOLVENT (VOLUNTARY ARRANGEMENT); EPC D; company owned;
  //          landlord/BTL; cohort 88.0% sell 15%+ under
  it('reproduces the exact ranked reason list of a real scored prospect', () => {
    const m: CohortModel = {
      ppsqftByCohort: new Map([['S64|F', 2105]]),
      ppsqftByDistrict: new Map([['S64', 2105]]),
      cellRate: new Map(),
      cohortRate: new Map([['S64|F', { n: 8, rate: 0.88, depth: 0.52 }]]),
    };
    const d: DwellingInput = {
      address: '1, CHURCH STREET, SWINTON',
      postcode: 'S64 8QA',
      district: 'S64',
      ptype: 'F',
      epc: 'D',
      epcGroup: 'DE',
      floorArea: 87,
      tenure: 'rental (private)',
      companyOwned: true,
      insolvent: true,
      ownerStatus: 'VOLUNTARY ARRANGEMENT',
    };
    const s = scoreDwelling(d, m);
    expect(s.reasons).toEqual([
      'OWNER INSOLVENT (VOLUNTARY ARRANGEMENT)',
      'EPC D',
      'company owned',
      'landlord/BTL',
      'cohort 88.0% sell 15%+ under',
    ]);
    // Confidence is a high-distress score in the proof's 0.8+ band.
    expect(s.confidence).toBeGreaterThan(0.8);
    expect(s.confidence).toBeLessThan(0.9);
  });
});
