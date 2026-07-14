import { describe, expect, it } from 'vitest';
import {
  scoreOffMarketPropensity,
  needsPropensityScore,
  ptypeFromLabel,
} from '@/server/deal-radar/off-market-score';
import type { DoorRef, DoorSignals, PatchPropensityIndex, Dwelling } from '@/server/deal-radar/ingest-stock';
import { computeCohortBaseRate, type SoldObservation } from '@/server/deal-radar/score';
import { deceasedEstatesEnabled } from '@/server/deal-radar/distress-sources';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * Off-market negotiability fusion (M3, AC-06). The patch index is built by hand
 * here (the same shape buildPatchPropensityIndex streams from Land Registry + EPC)
 * so the fusion is unit-tested without the multi-GB data files. The at-ingest
 * wiring and a real source-outage-mid-run are staging-checklist items, like the
 * rest of the DB-bound ingest path.
 */

// A learned S64 terraced cohort: 40 sold+EPC observations, floor 80sqm. Thirty at
// £120k (ppsqft 1500) and ten discounted at £90k, so the cohort learns a ppsqft
// median of 1500, a base discount rate of 0.25, and a median depth of 0.25.
const SOLD: SoldObservation[] = [
  ...Array.from({ length: 30 }, (): SoldObservation => ({ district: 'S64', ptype: 'T', epcGroup: 'DE', floorArea: 80, price: 120_000 })),
  ...Array.from({ length: 10 }, (): SoldObservation => ({ district: 'S64', ptype: 'T', epcGroup: 'DE', floorArea: 80, price: 90_000 })),
];
const MODEL = computeCohortBaseRate(SOLD);

/** A door in the EPC-joined map, keyed `${postcode}|${paonNum}|${ptype}`. */
function door(over: Partial<Dwelling> = {}): Dwelling {
  return {
    postcode: 'S64 8QA',
    paonNum: '14',
    address: '14 CHURCH STREET, SWINTON',
    epc: 'F',
    epcGroup: 'FG',
    ptype: 'T',
    floorArea: 80,
    tenure: 'owner-occupied',
    uprn: '100000',
    localAuthority: 'Rotherham',
    ...over,
  };
}

/**
 * Build a hand-made PatchPropensityIndex. `doors` are indexed by their join key;
 * `signals` maps a door's postcode|paon key to the DoorSignals returned for it (an
 * absent key yields the empty signal set).
 */
function makeIndex(opts: {
  doors?: Dwelling[];
  signals?: Record<string, DoorSignals>;
} = {}): PatchPropensityIndex {
  const dwellingByJoin = new Map<string, Dwelling>();
  for (const d of opts.doors ?? []) dwellingByJoin.set(`${d.postcode}|${d.paonNum}|${d.ptype}`, d);
  const EMPTY: DoorSignals = { companyOwned: false };
  return {
    model: MODEL,
    coreDistricts: new Set(['S64']),
    dwellings: new Map(),
    dwellingByJoin,
    ppsqftFor: (district, ptype) =>
      MODEL.ppsqftByCohort.get(`${district}|${ptype}`) ?? MODEL.ppsqftByDistrict.get(district),
    signalsForDoor: (ref: DoorRef) => (opts.signals ?? {})[`${ref.postcode}|${ref.paonNum}`] ?? EMPTY,
    stats: { transactions: SOLD.length, companiesMatched: 0, gazetteEvents: 0, pscLookups: 0 },
  };
}

function candidate(over: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    address: '14 Church Street, Swinton, S64 8QA',
    postcode: 'S64 8QA',
    propertyType: 'Terraced house',
    channel: 'portal',
    askingPrice: 120_000, // full asking = the est market value; NOT discounted
    listingUrl: 'https://rightmove.example/p/14-church-street',
    ...over,
  };
}

describe('ptypeFromLabel', () => {
  it('maps the common listing labels to Land Registry ptypes', () => {
    expect(ptypeFromLabel('Detached house')).toBe('D');
    expect(ptypeFromLabel('Semi-detached bungalow')).toBe('S'); // semi wins over detached
    expect(ptypeFromLabel('End of terrace')).toBe('T');
    expect(ptypeFromLabel('2 bed flat')).toBe('F');
    expect(ptypeFromLabel('Ground floor maisonette')).toBe('F');
    expect(ptypeFromLabel('Land / plot')).toBeNull();
    expect(ptypeFromLabel(undefined)).toBeNull();
  });
});

describe('needsPropensityScore', () => {
  it('is true for an on-market listing with no negotiability yet', () => {
    expect(needsPropensityScore(candidate(), 'on-market')).toBe(true);
  });

  it('is false once a negotiability score is present (idempotent re-run)', () => {
    const scored = candidate({ radar: { negotiability: { probability: 0.4, reasons: [], baseRate: 0.2 } } });
    expect(needsPropensityScore(scored, 'on-market')).toBe(false);
  });

  it('is false for off-market leads (the historic lens already owns those)', () => {
    expect(needsPropensityScore(candidate(), 'off-market')).toBe(false);
  });
});

describe('scoreOffMarketPropensity', () => {
  it('scores a FULL-ASKING on-market listing with a negotiability probability + reasons', () => {
    const index = makeIndex({ doors: [door({ epcGroup: 'FG', epc: 'F' })] });
    const s = scoreOffMarketPropensity(candidate(), index)!;
    expect(s).not.toBeNull();
    expect(s.negotiability.probability).toBeGreaterThan(0);
    // The cohort base rate (0.25) rides through even at full asking price.
    expect(s.negotiability.baseRate).toBeCloseTo(0.25, 5);
    // Reasons are ranked, strongest first, and always end with the cohort line.
    expect(s.negotiability.reasons.some((r) => /EPC F/.test(r))).toBe(true);
    expect(s.negotiability.reasons[s.negotiability.reasons.length - 1]).toMatch(/cohort .* sell 15%\+ under/);
    // Floor area is known (door joined), so an HPI-adjusted value is present.
    expect(s.negotiability.estMarketValue).toBe(120_000); // 80sqm * 1500 ppsqft, 5k-rounded
  });

  it('lifts the probability for a worse EPC (F/G above A/B/C in the same cohort)', () => {
    const idxFG = makeIndex({ doors: [door({ epcGroup: 'FG', epc: 'F' })] });
    const idxABC = makeIndex({ doors: [door({ epcGroup: 'ABC', epc: 'B' })] });
    const fg = scoreOffMarketPropensity(candidate(), idxFG)!;
    const abc = scoreOffMarketPropensity(candidate(), idxABC)!;
    expect(fg.negotiability.probability).toBeGreaterThan(abc.negotiability.probability);
  });

  it('enriches with owner-distress signals when the door carries them', () => {
    const index = makeIndex({
      doors: [door()],
      signals: {
        'S64 8QA|14': {
          companyOwned: true,
          insolvent: true,
          ownerStatus: 'liquidation',
        },
      },
    });
    const s = scoreOffMarketPropensity(candidate(), index)!;
    expect(s.negotiability.reasons.some((r) => /OWNER INSOLVENT/.test(r))).toBe(true);
    expect(s.negotiability.reasons.some((r) => /company owned/.test(r))).toBe(true);
  });

  it('still scores a listing NOT in the EPC data, from the cohort + the listing EPC', () => {
    // No door in the index for paon 99: falls back to the listing's own EPC rating,
    // no floor area (so no value estimate), but the cohort + EPC still score it.
    const index = makeIndex({ doors: [] });
    const s = scoreOffMarketPropensity(
      candidate({ address: '99 Church Street, Swinton, S64 8QA', epcRating: 'G' }),
      index
    )!;
    expect(s).not.toBeNull();
    expect(s.negotiability.probability).toBeGreaterThan(0);
    expect(s.negotiability.estMarketValue).toBeUndefined();
    expect(s.negotiability.reasons.some((r) => /EPC G/.test(r))).toBe(true);
  });

  it('returns null for a listing outside any learned cohort (not in the patch)', () => {
    const index = makeIndex({ doors: [] });
    expect(
      scoreOffMarketPropensity(candidate({ postcode: 'M1 1AA', address: '1 Nowhere Rd, Manchester, M1 1AA' }), index)
    ).toBeNull();
  });

  it('returns null when the property type cannot be classified', () => {
    const index = makeIndex({ doors: [door()] });
    expect(scoreOffMarketPropensity(candidate({ propertyType: 'Land' }), index)).toBeNull();
  });

  it('applies the HPI factor to the estimated value', () => {
    const index = makeIndex({ doors: [door()] });
    const base = scoreOffMarketPropensity(candidate(), index, { hpiFactor: 1 })!;
    const lifted = scoreOffMarketPropensity(candidate(), index, { hpiFactor: 1.1 })!;
    expect(lifted.negotiability.estMarketValue!).toBeGreaterThan(base.negotiability.estMarketValue!);
    expect(lifted.negotiability.estMarketValue).toBe(130_000); // 120k * 1.1, 5k-rounded
  });
});

describe('deceased-estates GDPR gate', () => {
  it('is OFF by default (person-level source never fires without deliberate opt-in)', () => {
    expect(deceasedEstatesEnabled()).toBe(false);
  });
});
