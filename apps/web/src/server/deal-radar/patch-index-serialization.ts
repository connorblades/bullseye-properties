/**
 * Serialize / rehydrate the Deal Radar patch index (BSE-OPP-P01 M5, AC-09/AC-10).
 *
 * The M2 discount scorer and the M3 negotiability scorer both consume an in-memory
 * patch index built by streaming the ~4.7GB local Land Registry / EPC / CCOD-OCOD /
 * Companies House files (`RDR_DATA_DIR`, Connor's Mac). In the cloud those files are
 * absent, so both scorers fail-soft and skip. This module lets a locally-built index
 * be serialised to a compact artifact, published, and rehydrated in the cloud - so a
 * listing ingested on Vercel carries the identical discount / negotiability score it
 * would carry locally, WITHOUT hosting the raw data.
 *
 * It wraps the EXISTING `buildPatchCompIndex` / `buildPatchPropensityIndex` output -
 * it serialises what they already produce and teaches a loader to rebuild the index
 * from it. No streaming and no scoring is re-implemented here.
 *
 * Two parity guarantees drive the shape:
 *  1. `resolveDoorSignals` is the SINGLE source of truth for a door's signals. The
 *     live index (ingest-stock) and the rehydrated index both call it, so a door
 *     resolves identically in memory and after a round-trip (AC-09). The signal
 *     graph (ownership OR'd across a door's companies, churn, hot streets, Gazette,
 *     empty-homes weight) is collapsed at build time into flat keyed tables keyed
 *     exactly as the resolver looks them up - by `${postcode}|${paonNum}`, by
 *     postcode, by local authority - so a listing that hits a learned cohort WITHOUT
 *     joining a known EPC door still resolves its owner/churn/hot signals faithfully,
 *     not just the doors present in `dwellingByJoin`.
 *  2. Person-level fields (`pscName`) are DROPPED by the serialiser unless the caller
 *     opts in (the deceased-estates / PSC gate deliberately on). `pscName` is
 *     approach-target metadata only - it never feeds the numeric score (score.ts
 *     reads it solely for `approachTarget` output, which the negotiability block does
 *     not carry) - so dropping it holds the GDPR gate in the cloud (AC-10) without
 *     changing any score.
 *
 * Pure + `node:fs`-free: only types are imported from the streaming builders, so this
 * module is unit-testable with a hand-built index and safe to import from the loader.
 * The big `dwellings` map (which only the local standing-stock lens iterates) is NOT
 * serialised - the cloud scorers never read it - which is most of the size win.
 */

import type { AuctionComp, CompIndex } from './auction-match';
import type { CohortModel, CohortStat, PropertyType } from './score';
import type {
  DoorRef,
  DoorSignals,
  Dwelling,
  PatchIndexStats,
  PatchPropensityIndex,
} from './ingest-stock';
import {
  areaMultiplierFor,
  isEmptyHomesHotspot,
  type AreaWeight,
  type AreaWeightTable,
} from './area-weights';
import { normalisePostcodeKey } from './distress-sources';

/** Bump when the serialized shape changes incompatibly; the loader rejects a mismatch. */
export const PATCH_INDEX_FORMAT_VERSION = 1;

// ── Resolved signal tables (the collapse of the per-door signal graph) ─────────

/** A Gazette forced-sale notice reduced to the two fields the resolver emits. */
export type ResolvedGazette = { noticeType: string; daysSinceEvent?: number };

/**
 * The owner-derived signals for one door key (`${postcode}|${paonNum}`), with the
 * Companies House distress flags already OR'd across every company at the door and
 * the strongest Gazette/PSC signal resolved. Presence of an entry means the door is
 * company-owned. `pscName` is person-level and dropped by the serialiser by default.
 */
export type ResolvedOwnerSignals = {
  isOverseas?: boolean;
  propertySic: boolean;
  insolvent: boolean;
  strikeOff: boolean;
  accountsOverdue: boolean;
  confstmtOverdue: boolean;
  dormant: boolean;
  hasCharges: boolean;
  ownerStatus?: string;
  /** How many DISTRESSED companies the owner's PSC also controls (a count, not person-level). */
  pscControlsDistressed?: number;
  /** Owner's PSC name - approach-target metadata only; dropped unless the gate is on. */
  pscName?: string;
  /** The company-number-matched Gazette notice (the strongest Gazette join). */
  gazetteByCompany?: ResolvedGazette;
};

/**
 * The flat keyed tables `resolveDoorSignals` reads. Built once by
 * `buildPatchPropensityIndex` and either used live or serialised + rehydrated.
 */
export type DoorSignalTables = {
  /** Key `${postcode}|${paonNum}` -> OR'd owner/company distress + Gazette-by-company. */
  ownerSignalsByKey: Map<string, ResolvedOwnerSignals>;
  /** Key `${postcode}|${paonNum}` -> Land Registry churn / loss-resale. */
  churnByKey: Map<string, { churned: boolean; resoldLoss: boolean }>;
  /** Key postcode -> hot streets (address contains-match) with their discounted share. */
  hotByPostcode: Map<string, { street: string; pctDisc: number }[]>;
  /** Key `normalisePostcodeKey(postcode)` -> exact-postcode Gazette notice. */
  gazetteByPostcode: Map<string, ResolvedGazette>;
  /** Council Taxbase empty-homes weight per local authority. */
  areaWeights: AreaWeightTable;
};

/**
 * Resolve one door's signals from the flat tables. This is the SINGLE resolver used
 * by both the live index and the rehydrated index, so scores match across a
 * round-trip (AC-09). It reproduces the original in-closure `signalsForDoor` exactly:
 * owner/company signals by `${postcode}|${paonNum}`, the company Gazette match else an
 * exact-postcode notice, the area weight by local authority, the strongest hot-street
 * contains-match, and churn by `${postcode}|${paonNum}`.
 */
export function resolveDoorSignals(tables: DoorSignalTables, door: DoorRef): DoorSignals {
  const owner = tables.ownerSignalsByKey.get(`${door.postcode}|${door.paonNum}`);

  // Prefer the company_number match; else an exact-postcode notice (a specific door,
  // not a whole district - the district would over-fire).
  const gazetteEvent = owner?.gazetteByCompany ?? tables.gazetteByPostcode.get(normalisePostcodeKey(door.postcode));

  // Empty-homes weight for this LA (known only for doors in the EPC data; a listing
  // off-EPC gets the neutral 1).
  const areaMultiplier = door.localAuthority ? areaMultiplierFor(tables.areaWeights, door.localAuthority) : 1;
  const areaHotspot = door.localAuthority ? isEmptyHomesHotspot(tables.areaWeights, door.localAuthority) : false;

  // Hot street: strongest matching street at this postcode (address contains it).
  let streetDisc: number | undefined;
  const hots = tables.hotByPostcode.get(door.postcode);
  if (hots) {
    for (const h of hots) {
      if (h.street && door.address.includes(h.street)) streetDisc = Math.max(streetDisc ?? 0, h.pctDisc);
    }
  }

  const churn = tables.churnByKey.get(`${door.postcode}|${door.paonNum}`);

  return {
    companyOwned: !!owner,
    isOverseas: owner?.isOverseas,
    propertySic: owner?.propertySic ?? false,
    churned: churn?.churned,
    resoldLoss: churn?.resoldLoss,
    streetDisc,
    insolvent: owner?.insolvent ?? false,
    strikeOff: owner?.strikeOff ?? false,
    accountsOverdue: owner?.accountsOverdue ?? false,
    confstmtOverdue: owner?.confstmtOverdue ?? false,
    dormant: owner?.dormant ?? false,
    hasCharges: owner?.hasCharges ?? false,
    ownerStatus: owner?.ownerStatus,
    // M10 distress-signal enrichment.
    gazetteEvent: gazetteEvent ? true : undefined,
    gazetteNoticeType: gazetteEvent?.noticeType,
    gazetteDaysSince: gazetteEvent?.daysSinceEvent,
    pscControlsDistressed: owner?.pscControlsDistressed || undefined,
    pscName: owner?.pscName,
    areaMultiplier: areaMultiplier !== 1 ? areaMultiplier : undefined,
    areaHotspot: areaHotspot || undefined,
  };
}

// ── Serialized shapes (all Maps/Sets flattened to JSON-friendly arrays) ─────────

export type SerializedCompIndex = {
  byDistrict: [string, AuctionComp[]][];
  byTown: [string, AuctionComp[]][];
};

export type SerializedCohortModel = {
  ppsqftByCohort: [string, number][];
  ppsqftByDistrict: [string, number][];
  cellRate: [string, CohortStat][];
  cohortRate: [string, CohortStat][];
};

export type SerializedDoorSignalTables = {
  ownerSignalsByKey: [string, ResolvedOwnerSignals][];
  churnByKey: [string, { churned: boolean; resoldLoss: boolean }][];
  hotByPostcode: [string, { street: string; pctDisc: number }[]][];
  gazetteByPostcode: [string, ResolvedGazette][];
  areaWeights: [string, AreaWeight][];
};

export type SerializedPropensityIndex = {
  model: SerializedCohortModel;
  coreDistricts: string[];
  /** The sold+EPC / listing join (`${postcode}|${paonNum}|${ptype}` -> Dwelling). */
  dwellingByJoin: [string, Dwelling][];
  tables: SerializedDoorSignalTables;
  stats: PatchIndexStats;
};

export type SerializedPatchIndex = {
  formatVersion: number;
  /** Caller-supplied version label (e.g. the data-refresh date). */
  version: string;
  /** ISO timestamp the artifact was built (stamped by the publish command). */
  builtAt: string;
  /** True only when person-level fields were deliberately retained (gate on). */
  personLevel: boolean;
  comp: SerializedCompIndex;
  propensity: SerializedPropensityIndex;
};

// ── Serialize ──────────────────────────────────────────────────────────────────

export function serializeCompIndex(index: CompIndex): SerializedCompIndex {
  return { byDistrict: [...index.byDistrict], byTown: [...index.byTown] };
}

/** Strip the person-level `pscName` from a resolved owner row (GDPR default). */
function dropPersonLevel(v: ResolvedOwnerSignals): ResolvedOwnerSignals {
  if (v.pscName === undefined) return v;
  const { pscName: _dropped, ...rest } = v;
  return rest;
}

export function serializePropensityIndex(
  index: PatchPropensityIndex,
  opts: { includePersonLevel?: boolean } = {}
): SerializedPropensityIndex {
  const includePersonLevel = opts.includePersonLevel ?? false;
  const ownerSignalsByKey: [string, ResolvedOwnerSignals][] = [...index.tables.ownerSignalsByKey].map(
    ([k, v]) => [k, includePersonLevel ? v : dropPersonLevel(v)]
  );
  return {
    model: {
      ppsqftByCohort: [...index.model.ppsqftByCohort],
      ppsqftByDistrict: [...index.model.ppsqftByDistrict],
      cellRate: [...index.model.cellRate],
      cohortRate: [...index.model.cohortRate],
    },
    coreDistricts: [...index.coreDistricts],
    dwellingByJoin: [...index.dwellingByJoin],
    tables: {
      ownerSignalsByKey,
      churnByKey: [...index.tables.churnByKey],
      hotByPostcode: [...index.tables.hotByPostcode],
      gazetteByPostcode: [...index.tables.gazetteByPostcode],
      areaWeights: [...index.tables.areaWeights],
    },
    stats: index.stats,
  };
}

/**
 * Serialise both indexes into one publishable artifact. Person-level fields are
 * dropped by default (`includePersonLevel` defaults false), so the GDPR gate holds
 * in the cloud exactly as it does locally.
 */
export function serializePatchIndex(
  comp: CompIndex,
  propensity: PatchPropensityIndex,
  meta: { version: string; builtAt: string; includePersonLevel?: boolean }
): SerializedPatchIndex {
  const includePersonLevel = meta.includePersonLevel ?? false;
  return {
    formatVersion: PATCH_INDEX_FORMAT_VERSION,
    version: meta.version,
    builtAt: meta.builtAt,
    personLevel: includePersonLevel,
    comp: serializeCompIndex(comp),
    propensity: serializePropensityIndex(propensity, { includePersonLevel }),
  };
}

// ── Rehydrate ────────────────────────────────────────────────────────────────

export function deserializeCompIndex(s: SerializedCompIndex): CompIndex {
  return { byDistrict: new Map(s.byDistrict), byTown: new Map(s.byTown) };
}

export function deserializePropensityIndex(s: SerializedPropensityIndex): PatchPropensityIndex {
  const model: CohortModel = {
    ppsqftByCohort: new Map(s.model.ppsqftByCohort),
    ppsqftByDistrict: new Map(s.model.ppsqftByDistrict),
    cellRate: new Map(s.model.cellRate),
    cohortRate: new Map(s.model.cohortRate),
  };
  const tables: DoorSignalTables = {
    ownerSignalsByKey: new Map(s.tables.ownerSignalsByKey),
    churnByKey: new Map(s.tables.churnByKey),
    hotByPostcode: new Map(s.tables.hotByPostcode),
    gazetteByPostcode: new Map(s.tables.gazetteByPostcode),
    areaWeights: new Map(s.tables.areaWeights),
  };
  const ppsqftFor = (district: string, ptype: PropertyType) =>
    model.ppsqftByCohort.get(`${district}|${ptype}`) ?? model.ppsqftByDistrict.get(district);
  return {
    model,
    coreDistricts: new Set(s.coreDistricts),
    // Not serialised: only the local standing-stock lens iterates `dwellings`; the
    // cloud scorers join via `dwellingByJoin` and never read it.
    dwellings: new Map(),
    dwellingByJoin: new Map(s.dwellingByJoin),
    ppsqftFor,
    signalsForDoor: (door: DoorRef) => resolveDoorSignals(tables, door),
    tables,
    stats: s.stats,
  };
}

export function deserializePatchIndex(s: SerializedPatchIndex): {
  comp: CompIndex;
  propensity: PatchPropensityIndex;
} {
  if (s.formatVersion !== PATCH_INDEX_FORMAT_VERSION) {
    throw new Error(
      `Patch index format mismatch: artifact v${s.formatVersion}, loader expects v${PATCH_INDEX_FORMAT_VERSION}`
    );
  }
  return { comp: deserializeCompIndex(s.comp), propensity: deserializePropensityIndex(s.propensity) };
}
