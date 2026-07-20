import { describe, expect, it } from 'vitest';
import {
  serializePatchIndex,
  serializePropensityIndex,
  deserializePatchIndex,
  resolveDoorSignals,
  PATCH_INDEX_FORMAT_VERSION,
  type DoorSignalTables,
} from '@/server/deal-radar/patch-index-serialization';
import { packPatchIndex, unpackPatchIndex } from '@/server/deal-radar/patch-index-store';
import { buildCompIndex, type AuctionComp, type CompIndex } from '@/server/deal-radar/auction-match';
import { scoreOnMarketCandidate } from '@/server/deal-radar/on-market-score';
import { scoreOffMarketPropensity } from '@/server/deal-radar/off-market-score';
import { computeCohortBaseRate, type SoldObservation } from '@/server/deal-radar/score';
import type { Dwelling, PatchPropensityIndex } from '@/server/deal-radar/ingest-stock';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * Patch-index serialize / rehydrate seam (M5, AC-09/AC-10). Builds a hand-made
 * index WITH its signal tables (the shape buildPatchPropensityIndex/CompIndex
 * produce), round-trips it through serialise -> JSON -> load, and asserts the
 * scorers return IDENTICAL discount + negotiability against the live and the
 * rehydrated index - for matched doors AND unmatched-but-in-cohort listings. Also
 * asserts the GDPR guardrail (no person-level field in the default artifact) and
 * that the dominant `dwellings` map is not serialised.
 */

// ── Comp index (Church Street, Swinton S64: median £120k) ──────────────────────
const comp = (price: number): AuctionComp => ({
  district: 'S64',
  town: 'swinton',
  street: 'CHURCH STREET',
  ptype: 'T',
  price,
  date: '2024-06-01',
});
const COMPS: AuctionComp[] = [95, 100, 105, 110, 115, 118, 122, 128, 132, 138, 142, 145].map((k) => comp(k * 1000));

// ── Propensity model (learned S64 terraced cohort) ─────────────────────────────
const SOLD: SoldObservation[] = [
  ...Array.from({ length: 30 }, (): SoldObservation => ({ district: 'S64', ptype: 'T', epcGroup: 'DE', floorArea: 80, price: 120_000 })),
  ...Array.from({ length: 10 }, (): SoldObservation => ({ district: 'S64', ptype: 'T', epcGroup: 'DE', floorArea: 80, price: 90_000 })),
];
const MODEL = computeCohortBaseRate(SOLD);

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
 * A live index with populated signal tables. `signalsForDoor` delegates to the same
 * `resolveDoorSignals` the rehydrated index uses, exactly as the real builder does.
 * The '14' door is company-owned + insolvent and carries a person-level pscName (to
 * prove the serialiser drops it) and a pscControlsDistressed count (kept - it scores).
 */
function makeLiveIndex(): PatchPropensityIndex {
  const d = door();
  const dwellingByJoin = new Map<string, Dwelling>([[`${d.postcode}|${d.paonNum}|${d.ptype}`, d]]);
  const tables: DoorSignalTables = {
    ownerSignalsByKey: new Map([
      [
        'S64 8QA|14',
        {
          isOverseas: false,
          propertySic: true,
          insolvent: true,
          strikeOff: false,
          accountsOverdue: true,
          confstmtOverdue: false,
          dormant: false,
          hasCharges: false,
          ownerStatus: 'liquidation',
          pscControlsDistressed: 3,
          pscName: 'Jane Doe', // person-level: must be dropped by the default serialiser
          gazetteByCompany: { noticeType: 'winding-up', daysSinceEvent: 40 },
        },
      ],
    ]),
    churnByKey: new Map([['S64 8QA|14', { churned: true, resoldLoss: true }]]),
    hotByPostcode: new Map([['S64 8QA', [{ street: 'CHURCH STREET', pctDisc: 0.7 }]]]),
    gazetteByPostcode: new Map([['S648QA', { noticeType: 'administration', daysSinceEvent: 90 }]]),
    areaWeights: new Map([['ROTHERHAM', { localAuthority: 'Rotherham', emptyRate: 0.03, multiplier: 1.2, hotspot: true }]]),
  };
  return {
    model: MODEL,
    coreDistricts: new Set(['S64']),
    dwellings: new Map(),
    dwellingByJoin,
    ppsqftFor: (district, ptype) => MODEL.ppsqftByCohort.get(`${district}|${ptype}`) ?? MODEL.ppsqftByDistrict.get(district),
    signalsForDoor: (ref) => resolveDoorSignals(tables, ref),
    tables,
    stats: { transactions: SOLD.length, companiesMatched: 1, gazetteEvents: 1, pscLookups: 1 },
  };
}

function candidate(over: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    address: '14 Church Street, Swinton, S64 8QA',
    postcode: 'S64 8QA',
    propertyType: 'Terraced house',
    channel: 'portal',
    askingPrice: 120_000,
    listingUrl: 'https://rightmove.example/p/14-church-street',
    ...over,
  };
}

/** Round-trip a live index through serialise -> JSON string -> load. */
function roundTrip(comp: CompIndex, prop: PatchPropensityIndex, opts: { includePersonLevel?: boolean } = {}) {
  const serialized = serializePatchIndex(comp, prop, {
    version: '2026-07-20',
    builtAt: '2026-07-20T00:00:00.000Z',
    includePersonLevel: opts.includePersonLevel,
  });
  const json = JSON.stringify(serialized); // prove it survives real JSON (Maps/Sets flattened)
  return { serialized, json, loaded: deserializePatchIndex(JSON.parse(json)) };
}

describe('AC-09 published-index parity', () => {
  const compIndex = buildCompIndex(COMPS);
  const live = makeLiveIndex();
  const { loaded } = roundTrip(compIndex, live);

  it('negotiability is identical for a MATCHED door (live vs rehydrated)', () => {
    const c = candidate();
    const a = scoreOffMarketPropensity(c, live);
    const b = scoreOffMarketPropensity(c, loaded.propensity);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('negotiability is identical for an UNMATCHED-but-in-cohort listing (the parity trap)', () => {
    // paon 99 has no door in dwellingByJoin, but S64|T is a learned cohort; it still
    // resolves owner/churn/hot signals by key, so the rehydrated tables must match.
    const c = candidate({ address: '99 Church Street, Swinton, S64 8QA', epcRating: 'G' });
    const a = scoreOffMarketPropensity(c, live);
    const b = scoreOffMarketPropensity(c, loaded.propensity);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('discount + comp evidence are identical (live vs rehydrated comp index)', () => {
    const c = candidate({ askingPrice: 96_000 }); // 20% below the £120k median
    const a = scoreOnMarketCandidate(c, compIndex);
    const b = scoreOnMarketCandidate(c, loaded.comp);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('resolves any door identically across the round-trip (owner + area + hot + gazette)', () => {
    const ref = { postcode: 'S64 8QA', paonNum: '14', address: '14 CHURCH STREET, SWINTON', localAuthority: 'Rotherham' };
    // Person-level pscName is dropped in the artifact, so compare the score-bearing
    // fields only (approachTarget is derived from pscName and never persisted).
    const liveSig = { ...live.signalsForDoor(ref), pscName: undefined };
    const loadedSig = { ...loaded.propensity.signalsForDoor(ref), pscName: undefined };
    expect(loadedSig).toEqual(liveSig);
  });
});

describe('AC-10 no person-level leak + size', () => {
  const compIndex = buildCompIndex(COMPS);
  const live = makeLiveIndex();

  it('drops pscName from the default artifact, but keeps the pscControlsDistressed count', () => {
    const { serialized, json } = roundTrip(compIndex, live);
    expect(json).not.toContain('Jane Doe');
    const owner = serialized.propensity.tables.ownerSignalsByKey.find(([k]) => k === 'S64 8QA|14')![1];
    expect(owner.pscName).toBeUndefined();
    expect(owner.pscControlsDistressed).toBe(3); // a count, not person-level -> retained
    expect(serialized.personLevel).toBe(false);
  });

  it('retains pscName only when person-level is deliberately included (gate on)', () => {
    const withPii = serializePropensityIndex(live, { includePersonLevel: true });
    const owner = withPii.tables.ownerSignalsByKey.find(([k]) => k === 'S64 8QA|14')![1];
    expect(owner.pscName).toBe('Jane Doe');
  });

  it('omits the dominant `dwellings` map from the artifact (the size win)', () => {
    const { serialized, loaded } = roundTrip(compIndex, live);
    expect('dwellings' in serialized.propensity).toBe(false);
    expect(loaded.propensity.dwellings.size).toBe(0); // rehydrated empty; scorers never read it
  });
});

describe('gzip pack / unpack + format guard', () => {
  it('unpack(pack(x)) deep-equals x, and gzip is materially smaller than raw JSON', () => {
    const { serialized } = roundTrip(buildCompIndex(COMPS), makeLiveIndex());
    const packed = packPatchIndex(serialized);
    expect(unpackPatchIndex(packed)).toEqual(serialized);
    expect(packed.length).toBeLessThan(Buffer.byteLength(JSON.stringify(serialized), 'utf8'));
  });

  it('rejects an artifact built by an incompatible format version', () => {
    const { serialized } = roundTrip(buildCompIndex(COMPS), makeLiveIndex());
    const bad = { ...serialized, formatVersion: PATCH_INDEX_FORMAT_VERSION + 1 };
    expect(() => deserializePatchIndex(bad)).toThrow(/format mismatch/i);
  });
});
