/**
 * Deal Radar stock-scoring worker (M8).
 *
 * Streams the locally-held open-data files (Land Registry Price Paid, EPC
 * certificates, HMLR CCOD/OCOD corporate ownership, Companies House bulk),
 * builds the size-normalised cohort model, scores the standing housing stock for
 * motivated-seller propensity with server/deal-radar/score.ts, and emits the top
 * matches as ScrapedCandidates into the M7 intake seam.
 *
 * Two layers, mirroring land-ownership.ts:
 *  - computeStockScores(...): pure-of-DB. Streams the CSVs (never buffering the
 *    multi-GB files), returns { stats, candidates }. No auth, no DB - so it can
 *    be dry-run against the local data to check the AC-15 yardstick.
 *  - runDealRadarScore(tenantId, ...): calls computeStockScores then ingests the
 *    candidates via ingestCandidatesForTenant (dynamically imported so the pure
 *    layer carries no server-action dependency at module load).
 *
 * Core patch first: Land Registry is filtered to RDR_LR_DISTRICTS (default
 * Bassetlaw + Rotherham); the postcode-district set that filter yields then
 * scopes EPC and ownership, and the owning company numbers scope the Companies
 * House scan. All open data (OGL); no person-level sources in M8.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseCsvLine } from '@/server/public-data/land-ownership';
import { failSoft } from '@/server/public-data/http';
import {
  computeCohortBaseRate,
  scoreDwelling,
  dwellingToCandidate,
  epcGroupOf,
  ptypeOf,
  leadingNumber,
  type SoldObservation,
  type CohortModel,
  type DwellingInput,
  type PropertyType,
} from './score';
import {
  fetchGazetteInsolvency,
  indexGazetteEvents,
  fetchPsc,
  buildPscPortfolio,
  type GazetteInsolvencyEvent,
  type GazetteIndex,
  type PscControl,
  type CompanyPscInput,
} from './distress-sources';
import {
  buildAreaWeightTable,
  type AreaWeightTable,
  type TaxbaseRow,
} from './area-weights';
import {
  resolveDoorSignals,
  type DoorSignalTables,
  type ResolvedGazette,
  type ResolvedOwnerSignals,
} from './patch-index-serialization';
import type { ScrapedCandidate } from '@/lib/lead-intake';

// ── Config ───────────────────────────────────────────────────────────────────

/** Land Registry districts that define the patch (matched on the LR district column). */
export const RDR_LR_DISTRICTS = (process.env.RDR_LR_DISTRICTS ?? 'BASSETLAW,ROTHERHAM')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const DEFAULT_DATA_DIR =
  process.env.RDR_DATA_DIR ?? '/Users/connorblades32/Documents/Companies/Bullseye Properties/data/Open Source Data';

/** Gazette insolvency enrichment is off unless deliberately enabled (fail-soft when on). */
const GAZETTE_ENABLED = process.env.RDR_GAZETTE_ENABLE === 'true';
/** Companies House PSC enrichment is off unless enabled AND a CH key is present. */
const PSC_ENABLED = process.env.RDR_PSC_ENABLE === 'true';
/** Cap on PSC lookups per run (rate-limit / cost guard). */
const PSC_MAX_LOOKUPS = Number(process.env.RDR_PSC_MAX ?? '500');
/** Cap on Gazette seed postcodes per run (one call each, postcode + radius). */
const GAZETTE_MAX_SEEDS = Number(process.env.RDR_GAZETTE_MAX_SEEDS ?? '12');
/** Optional Council Taxbase CSV extract (localAuthority, dwellings, longTermEmpty, premiumCharged). */
const TAXBASE_FILE = process.env.RDR_TAXBASE_FILE;

export type StockScoreOptions = {
  dataDir?: string;
  /** LR district names defining the patch. Defaults to RDR_LR_DISTRICTS. */
  lrDistricts?: string[];
  /** Scalar HPI adjustment applied to cohort market value (default 1). */
  hpiFactor?: number;
  /** Max candidates to emit (highest confidence first). Default 500. */
  topN?: number;
  /** Only emit candidates at/above this confidence 0..1. Default 0. */
  minConfidence?: number;
  /** Run identifier baked into each candidate's sourceRef. */
  run?: string;
  /** Capture timestamp (ISO) stamped on each candidate. */
  capturedAt?: string;
  /** Progress sink. */
  log?: (m: string) => void;
  // ── M10 distress-signal enrichment (all fail-soft; injectable for tests/dry-runs) ──
  /**
   * Pre-built area-weight table (Council Taxbase empty-homes premium). When
   * omitted, it is loaded fail-soft from RDR_TAXBASE_FILE, else a neutral table.
   */
  areaWeights?: AreaWeightTable;
  /**
   * Pre-fetched Gazette insolvency events to index. When omitted, they are
   * fetched fail-soft across patch seed postcodes IF RDR_GAZETTE_ENABLE is set,
   * else none.
   */
  gazetteEvents?: GazetteInsolvencyEvent[];
  /**
   * PSC lookup by company_number. When omitted, the real Companies House client
   * is used IF RDR_PSC_ENABLE is set and a key is present, else PSC is skipped.
   * Wrapped in failSoft at the call site, so a throwing lookup degrades to [].
   */
  pscLookup?: (companyNumber: string) => Promise<PscControl[]>;
};

/** The AC-15 regression counts, plus the emitted-candidate count. */
export type StockScoreStats = {
  transactions: number;
  dwellingsScored: number;
  conf60: number;
  conf40: number;
  companyOwned: number;
  epcFG: number;
  companiesMatched: number;
  ownerDistress: number;
  emitted: number;
  // M10 distress-signal enrichment counters.
  gazetteEvents: number;
  gazetteHits: number;
  pscLookups: number;
  pscPortfolioHits: number;
  areaHotspotDwellings: number;
};

export type StockScoreResult = {
  stats: StockScoreStats;
  candidates: ScrapedCandidate[];
};

// ── Local-file streaming ─────────────────────────────────────────────────────

/**
 * Stream a local CSV row-by-row (never buffering the whole file). Yields the
 * parsed columns of each non-empty line, header included.
 */
async function* streamCsv(path: string): AsyncGenerator<string[]> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield parseCsvLine(line);
  }
}

/** First header index whose (trimmed, lower-cased) name equals `name`. */
function headerIndex(header: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === target);
}

/**
 * Load a Council Taxbase CSV extract into an area-weight table, fail-soft. The
 * CSV needs columns localAuthority / dwellings / longTermEmpty / premiumCharged
 * (header-matched, case-insensitive). Any missing file or parse error yields a
 * neutral (empty) table so the run is never broken by this source.
 */
async function loadAreaWeightTable(path: string | undefined, log: (m: string) => void): Promise<AreaWeightTable> {
  if (!path) return new Map();
  const table = await failSoft('rdr-taxbase', async () => {
    const rows: TaxbaseRow[] = [];
    let header: string[] | null = null;
    let col: Record<string, number> = {};
    for await (const cols of streamCsv(path)) {
      if (!header) {
        header = cols;
        col = {
          la: headerIndex(header, 'localAuthority'),
          dwellings: headerIndex(header, 'dwellings'),
          empty: headerIndex(header, 'longTermEmpty'),
          premium: headerIndex(header, 'premiumCharged'),
        };
        continue;
      }
      const localAuthority = (cols[col.la] ?? '').trim();
      if (!localAuthority) continue;
      const num = (i: number) => Number((cols[i] ?? '').replace(/[^0-9.]/g, '')) || 0;
      rows.push({
        localAuthority,
        dwellings: num(col.dwellings),
        longTermEmpty: num(col.empty),
        premiumCharged: num(col.premium),
      });
    }
    return buildAreaWeightTable(rows);
  });
  if (table) log(`Area weights: loaded ${table.size} local authorities from ${path}.`);
  return table ?? new Map();
}

const upperTrim = (s: string | undefined) => (s ?? '').trim().toUpperCase();
/** Postcode district: leading letters + digits, e.g. "S80 2RE" -> "S80". */
const districtOf = (postcode: string) => (upperTrim(postcode).match(/^[A-Z]+[0-9]+/) ?? [''])[0];
/** Normalise a company number: all-digit -> 8-wide zero-pad; else upper, no spaces. */
function normaliseCompanyNumber(raw: string): string {
  const c = raw.replace(/\s+/g, '').toUpperCase();
  return /^[0-9]+$/.test(c) ? c.padStart(8, '0') : c;
}

// ── Land Registry Price Paid columns (no header, positional) ─────────────────
const LR = { price: 1, xferDate: 2, postcode: 3, ptype: 4, paon: 7, street: 9, district: 12, ppdCat: 14 } as const;
const RESI_TYPES = new Set<PropertyType>(['D', 'S', 'T', 'F']);

type Txn = { postcode: string; paonNum: string; ptype: PropertyType; street: string; price: number; date: string };

// ── Patch propensity index (shared by the stock lens + the on-market fusion) ──

/** One EPC-joined door in the patch, deduped to its latest certificate. */
export type Dwelling = {
  postcode: string;
  paonNum: string;
  address: string;
  epc: string;
  epcGroup: ReturnType<typeof epcGroupOf>;
  ptype: PropertyType;
  floorArea: number;
  tenure: string;
  uprn: string;
  localAuthority: string;
};

/**
 * A door the signal accessor keys on: postcode+paon identify it, the address
 * drives the hot-street contains-match, and the local authority (known only for
 * doors that appear in the EPC data) the empty-homes join.
 */
export type DoorRef = {
  postcode: string;
  paonNum: string;
  address: string;
  localAuthority?: string;
};

/**
 * The signal-derived subset of a DwellingInput: everything beyond the door's own
 * geometry/EPC (ownership, Companies House distress, churn/loss, hot street,
 * empty-homes weight, Gazette/PSC). Assembled identically for the stock lens and
 * the on-market fusion so both routes to a negotiability score agree.
 */
export type DoorSignals = Pick<
  DwellingInput,
  | 'companyOwned'
  | 'isOverseas'
  | 'propertySic'
  | 'churned'
  | 'resoldLoss'
  | 'streetDisc'
  | 'insolvent'
  | 'strikeOff'
  | 'accountsOverdue'
  | 'confstmtOverdue'
  | 'dormant'
  | 'hasCharges'
  | 'ownerStatus'
  | 'gazetteEvent'
  | 'gazetteNoticeType'
  | 'gazetteDaysSince'
  | 'pscControlsDistressed'
  | 'pscName'
  | 'areaMultiplier'
  | 'areaHotspot'
>;

/** Index-build counters folded into StockScoreStats by computeStockScores. */
export type PatchIndexStats = {
  transactions: number;
  companiesMatched: number;
  gazetteEvents: number;
  pscLookups: number;
};

/**
 * The learned patch index: the size-normalised cohort base-rate model plus a
 * per-door signal accessor, built from the same open-data streams the stock lens
 * uses. Shared by computeStockScores (which iterates `dwellings` to score standing
 * stock) and the on-market negotiability fusion (which looks a listing's door up in
 * `dwellingByJoin` and calls `signalsForDoor`), so both price identically.
 */
export type PatchPropensityIndex = {
  model: CohortModel;
  coreDistricts: Set<string>;
  /** Deduped EPC doors keyed `${postcode}|${paonNum}|${address}` (the stock lens iterates these). */
  dwellings: Map<string, { lodged: string; d: Dwelling }>;
  /** First door per `${postcode}|${paonNum}|${ptype}` (the sold+EPC / listing join). */
  dwellingByJoin: Map<string, Dwelling>;
  ppsqftFor: (district: string, ptype: PropertyType) => number | undefined;
  signalsForDoor: (door: DoorRef) => DoorSignals;
  /**
   * The flat keyed signal tables `signalsForDoor` resolves over (M5). Exposed so the
   * index can be serialised to a published artifact and rehydrated in the cloud with
   * scores identical to this in-memory build (AC-09). `signalsForDoor` here is a thin
   * wrapper over `resolveDoorSignals(tables, door)`, the same resolver the rehydrated
   * index uses.
   */
  tables: DoorSignalTables;
  stats: PatchIndexStats;
};

/** The options buildPatchPropensityIndex reads (the streaming/enrichment subset of StockScoreOptions). */
export type PatchPropensityOptions = Pick<
  StockScoreOptions,
  'dataDir' | 'lrDistricts' | 'capturedAt' | 'log' | 'areaWeights' | 'gazetteEvents' | 'pscLookup'
>;

/**
 * Stream the patch open-data files into the propensity index: the cohort model
 * plus every per-door signal (ownership, Companies House distress, churn/loss, hot
 * streets, empty-homes area weight, and the fail-soft Gazette/PSC enrichment).
 * Never buffers the multi-GB files. A missing data directory throws from the read
 * stream - the fusion caller (lead-review) wraps this in try/catch and skips
 * scoring fail-soft when the data is not present (the cloud-hosting follow-up);
 * the local stock-lens caller lets it surface.
 */
export async function buildPatchPropensityIndex(
  opts: PatchPropensityOptions = {}
): Promise<PatchPropensityIndex> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const lrDistricts = new Set((opts.lrDistricts ?? RDR_LR_DISTRICTS).map((d) => d.toUpperCase()));
  const capturedAt = opts.capturedAt ?? '';
  const log = opts.log ?? (() => {});

  // 1. Land Registry: qualifying residential type-A sales in the patch districts.
  //    Also derives the core postcode-district set that scopes everything else.
  const coreDistricts = new Set<string>();
  const txns: Txn[] = [];
  for (const years of [2023, 2024, 2025, 2026]) {
    const path = `${dataDir}/Land Reg/pp-${years}.csv`;
    let seen = 0;
    for await (const cols of streamCsv(path)) {
      seen++;
      if (upperTrim(cols[LR.district]) === '' || !lrDistricts.has(upperTrim(cols[LR.district]))) continue;
      if (upperTrim(cols[LR.ppdCat]) !== 'A') continue;
      const ptype = upperTrim(cols[LR.ptype]) as PropertyType;
      if (!RESI_TYPES.has(ptype)) continue;
      const price = Number((cols[LR.price] ?? '').replace(/[^0-9]/g, ''));
      if (!Number.isFinite(price) || price < 10000 || price > 2000000) continue;
      const postcode = upperTrim(cols[LR.postcode]);
      const district = districtOf(postcode);
      if (!district) continue;
      coreDistricts.add(district);
      txns.push({
        postcode,
        paonNum: leadingNumber(upperTrim(cols[LR.paon])),
        ptype,
        street: upperTrim(cols[LR.street]),
        price,
        date: (cols[LR.xferDate] ?? '').trim().slice(0, 10),
      });
    }
    log(`Land Reg pp-${years}: scanned ${seen}, kept ${txns.length} patch sales so far`);
  }
  log(`Patch: ${txns.length} transactions across ${coreDistricts.size} postcode districts`);

  // 2. EPC: dedupe to the latest certificate per door, classify, scope to patch.
  const dwellings = new Map<string, { lodged: string; d: Dwelling }>();
  for (const laFile of ['Bassetlaw-certificates.csv', 'Rotherham-certificates.csv']) {
    const path = `${dataDir}/EPC/${laFile}`;
    // The EPC file is per-LA; the LA name (for the area-weight join) is its stem.
    const localAuthority = laFile.replace(/-certificates\.csv$/i, '');
    let header: string[] | null = null;
    let col: Record<string, number> = {};
    let kept = 0;
    for await (const cols of streamCsv(path)) {
      if (!header) {
        header = cols;
        col = {
          address1: headerIndex(header, 'ADDRESS1'),
          address: headerIndex(header, 'ADDRESS'),
          postcode: headerIndex(header, 'POSTCODE'),
          epc: headerIndex(header, 'CURRENT_ENERGY_RATING'),
          propType: headerIndex(header, 'PROPERTY_TYPE'),
          builtForm: headerIndex(header, 'BUILT_FORM'),
          tenure: headerIndex(header, 'TENURE'),
          floorArea: headerIndex(header, 'TOTAL_FLOOR_AREA'),
          uprn: headerIndex(header, 'UPRN'),
          lodged: headerIndex(header, 'LODGEMENT_DATETIME'),
        };
        continue;
      }
      const postcode = upperTrim(cols[col.postcode]);
      const district = districtOf(postcode);
      if (!coreDistricts.has(district)) continue;
      const ptype = ptypeOf(cols[col.propType] ?? '', cols[col.builtForm] ?? '');
      if (!ptype) continue;
      const paonNum = leadingNumber(upperTrim(cols[col.address1]));
      if (!paonNum) continue;
      const floorArea = Number(cols[col.floorArea]);
      const address = upperTrim(cols[col.address]);
      const lodged = (cols[col.lodged] ?? '').trim();
      const key = `${postcode}|${paonNum}|${address}`;
      const existing = dwellings.get(key);
      if (existing && existing.lodged >= lodged) continue;
      dwellings.set(key, {
        lodged,
        d: {
          postcode,
          paonNum,
          address,
          epc: upperTrim(cols[col.epc]),
          epcGroup: epcGroupOf(cols[col.epc] ?? ''),
          ptype,
          floorArea: Number.isFinite(floorArea) ? floorArea : 0,
          tenure: (cols[col.tenure] ?? '').trim().toLowerCase(),
          uprn: (cols[col.uprn] ?? '').trim(),
          localAuthority,
        },
      });
      kept++;
    }
    log(`EPC ${laFile}: ${kept} rows in patch, ${dwellings.size} unique dwellings so far`);
  }

  // Index dwellings by (postcode,paon,ptype) for the sold+EPC join.
  const dwellingByJoin = new Map<string, Dwelling>();
  for (const { d } of dwellings.values()) {
    const jk = `${d.postcode}|${d.paonNum}|${d.ptype}`;
    if (!dwellingByJoin.has(jk)) dwellingByJoin.set(jk, d);
  }

  // 3. Sold+EPC observations -> cohort model (size-normalised base rate).
  const sold: SoldObservation[] = [];
  for (const t of txns) {
    const d = dwellingByJoin.get(`${t.postcode}|${t.paonNum}|${t.ptype}`);
    if (!d || d.floorArea < 20 || d.floorArea > 500) continue;
    sold.push({ district: districtOf(t.postcode), ptype: t.ptype, epcGroup: d.epcGroup, floorArea: d.floorArea, price: t.price });
  }
  const model: CohortModel = computeCohortBaseRate(sold);
  log(`Cohort model: ${sold.length} sold+EPC obs, ${model.ppsqftByCohort.size} cohort ppsqft cells`);

  const ppsqftFor = (district: string, ptype: PropertyType) =>
    model.ppsqftByCohort.get(`${district}|${ptype}`) ?? model.ppsqftByDistrict.get(district);

  // 4. Property-level churn / loss-resale, keyed by (postcode,paon).
  type Churn = { prices: { price: number; date: string }[] };
  const churnAcc = new Map<string, Churn>();
  for (const t of txns) {
    if (!t.paonNum) continue;
    const k = `${t.postcode}|${t.paonNum}`;
    (churnAcc.get(k) ?? churnAcc.set(k, { prices: [] }).get(k)!).prices.push({ price: t.price, date: t.date });
  }
  const churnByKey = new Map<string, { churned: boolean; resoldLoss: boolean }>();
  for (const [k, c] of churnAcc) {
    if (c.prices.length < 2) continue;
    const sortedByDate = [...c.prices].sort((a, b) => a.date.localeCompare(b.date));
    const first = sortedByDate[0].price;
    const last = sortedByDate[sortedByDate.length - 1].price;
    churnByKey.set(k, { churned: true, resoldLoss: last < first });
  }

  // 5. Hot streets: (postcode,street) selling >=60% below size-normalised value.
  type Hot = { total: number; disc: number };
  const hotAcc = new Map<string, Hot>();
  for (const t of txns) {
    const d = dwellingByJoin.get(`${t.postcode}|${t.paonNum}|${t.ptype}`);
    if (!d || d.floorArea < 20 || d.floorArea > 500) continue;
    const ppsqft = ppsqftFor(districtOf(t.postcode), t.ptype);
    if (ppsqft == null) continue;
    const refValue = d.floorArea * ppsqft;
    if (refValue <= 0) continue;
    const k = `${t.postcode}|${t.street}`;
    const h = hotAcc.get(k) ?? hotAcc.set(k, { total: 0, disc: 0 }).get(k)!;
    h.total++;
    if (t.price <= 0.85 * refValue) h.disc++;
  }
  const hotByPostcode = new Map<string, { street: string; pctDisc: number }[]>();
  for (const [k, h] of hotAcc) {
    if (h.total < 6) continue;
    const pctDisc = h.disc / h.total;
    if (pctDisc < 0.6) continue;
    const [postcode, street] = k.split('|');
    (hotByPostcode.get(postcode) ?? hotByPostcode.set(postcode, []).get(postcode)!).push({ street, pctDisc });
  }
  log(`Hot streets: ${[...hotByPostcode.values()].reduce((a, v) => a + v.length, 0)} street/postcode pairs`);

  // 6. Ownership (CCOD/OCOD): collapse to one record per door.
  type Owner = { companyNumbers: Set<string>; isOverseas: boolean };
  const ownerByKey = new Map<string, Owner>();
  for (const [file, overseas] of [
    ['UK_companies.csv', false],
    ['Overseas_companies.csv', true],
  ] as const) {
    const path = `${dataDir}/${file}`;
    let header: string[] | null = null;
    let iPostcode = -1;
    let iAddress = -1;
    let iCompany = -1;
    let kept = 0;
    for await (const cols of streamCsv(path)) {
      if (!header) {
        header = cols;
        iPostcode = headerIndex(header, 'Postcode');
        iAddress = headerIndex(header, 'Property Address');
        iCompany = headerIndex(header, 'Company Registration No. (1)');
        continue;
      }
      const postcode = upperTrim(cols[iPostcode]);
      if (!coreDistricts.has(districtOf(postcode))) continue;
      const paonNum = leadingNumber(upperTrim(cols[iAddress]));
      if (!paonNum) continue;
      const key = `${postcode}|${paonNum}`;
      const owner = ownerByKey.get(key) ?? ownerByKey.set(key, { companyNumbers: new Set(), isOverseas: false }).get(key)!;
      const cono = normaliseCompanyNumber(cols[iCompany] ?? '');
      if (cono) owner.companyNumbers.add(cono);
      if (overseas) owner.isOverseas = true;
      kept++;
    }
    log(`${file}: ${kept} patch title rows, ${ownerByKey.size} owned doors so far`);
  }

  // 7. Companies House distress: scan the bulk file, keep only owning companies.
  const conums = new Set<string>();
  for (const o of ownerByKey.values()) for (const c of o.companyNumbers) conums.add(c);
  type ChFlags = {
    status: string;
    insolvent: boolean;
    strikeOff: boolean;
    accountsOverdue: boolean;
    confstmtOverdue: boolean;
    dormant: boolean;
    hasCharges: boolean;
    propertySic: boolean;
  };
  const chByCompany = new Map<string, ChFlags>();
  const today = capturedAt ? new Date(capturedAt) : new Date(0);
  const parseUkDate = (s: string): number | null => {
    const m = (s ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  };
  {
    const path = `${dataDir}/companies_house_bulk.csv`;
    let header: string[] | null = null;
    let col: Record<string, number> = {};
    let scanned = 0;
    for await (const cols of streamCsv(path)) {
      if (!header) {
        header = cols;
        col = {
          company: headerIndex(header, 'CompanyNumber'),
          status: headerIndex(header, 'CompanyStatus'),
          accountsDue: headerIndex(header, 'Accounts.NextDueDate'),
          acctCat: headerIndex(header, 'Accounts.AccountCategory'),
          returnsDue: headerIndex(header, 'Returns.NextDueDate'),
          mortOut: headerIndex(header, 'Mortgages.NumMortOutstanding'),
          sic1: headerIndex(header, 'SICCode.SicText_1'),
        };
        continue;
      }
      scanned++;
      const cono = normaliseCompanyNumber(cols[col.company] ?? '');
      if (!conums.has(cono) || chByCompany.has(cono)) continue;
      const status = upperTrim(cols[col.status]);
      const acctCat = upperTrim(cols[col.acctCat]);
      const sic1 = upperTrim(cols[col.sic1]);
      const accountsDue = parseUkDate(cols[col.accountsDue] ?? '');
      const returnsDue = parseUkDate(cols[col.returnsDue] ?? '');
      const mortOut = Number((cols[col.mortOut] ?? '').replace(/[^0-9]/g, ''));
      chByCompany.set(cono, {
        status,
        insolvent: /LIQUIDATION|ADMINISTRAT|RECEIVER|VOLUNTARY ARRANGEMENT/.test(status),
        strikeOff: status.includes('STRIKE'),
        accountsOverdue: accountsDue != null && accountsDue < today.getTime(),
        confstmtOverdue: returnsDue != null && returnsDue < today.getTime(),
        dormant: acctCat.includes('DORMANT'),
        hasCharges: Number.isFinite(mortOut) && mortOut > 0,
        propertySic: /^(6810|6820|6831|6832)/.test(sic1),
      });
      if (scanned % 1_000_000 === 0) log(`Companies House: scanned ${scanned}, matched ${chByCompany.size}`);
    }
    log(`Companies House: scanned ${scanned}, matched ${chByCompany.size} owning companies`);
  }

  // ── 7.5 M10 distress-signal enrichment (all fail-soft) ───────────────────────
  const isDistressed = (f: ChFlags) => f.insolvent || f.strikeOff || f.accountsOverdue || f.dormant;

  // 7.5a Area weights: Council Taxbase empty-homes premium per local authority.
  const areaWeights: AreaWeightTable = opts.areaWeights ?? (await loadAreaWeightTable(TAXBASE_FILE, log));

  // 7.5b Gazette insolvency notices: fetch across patch seed postcodes (one call
  //      each, postcode + radius), index by company_number and district. Off
  //      unless enabled or events are injected; a fetch failure yields no events.
  let gazetteIndex: GazetteIndex = { byCompany: new Map(), byPostcode: new Map() };
  let gazetteEvents: GazetteInsolvencyEvent[] = opts.gazetteEvents ?? [];
  if (!opts.gazetteEvents && GAZETTE_ENABLED) {
    // Seed one representative full postcode per district, capped, to cover the
    // patch with radius searches without an unbounded fan-out.
    const seedByDistrict = new Map<string, string>();
    for (const t of txns) {
      const dist = districtOf(t.postcode);
      if (dist && !seedByDistrict.has(dist)) seedByDistrict.set(dist, t.postcode);
    }
    const seeds = [...seedByDistrict.values()].slice(0, GAZETTE_MAX_SEEDS);
    for (const postcode of seeds) {
      const events = await fetchGazetteInsolvency({ postcode, asOf: capturedAt || undefined, log });
      gazetteEvents.push(...events);
    }
    log(`Gazette insolvency: ${gazetteEvents.length} notices across ${seeds.length} seed postcodes.`);
  }
  gazetteIndex = indexGazetteEvents(gazetteEvents);

  // 7.5c Companies House PSC: for the DISTRESSED owning companies only (bounded),
  //      resolve control persons and roll up "controls N distressed cos". The
  //      person's name is carried only as approach-target metadata downstream.
  const pscNameByCompany = new Map<string, string>();
  let pscPortfolio = new Map<string, { controlsDistressed: number; pscName?: string }>();
  let pscLookups = 0;
  const pscLookup =
    opts.pscLookup ?? (PSC_ENABLED ? (cono: string) => fetchPsc(cono) : undefined);
  if (pscLookup) {
    const distressedConums = [...chByCompany.entries()]
      .filter(([, f]) => isDistressed(f))
      .map(([cono]) => cono)
      .slice(0, PSC_MAX_LOOKUPS);
    const pscInputs: CompanyPscInput[] = [];
    for (const cono of distressedConums) {
      // failSoft so even an injected throwing lookup degrades to [] (fail-soft).
      const pscs = (await failSoft(`rdr-psc ${cono}`, () => pscLookup(cono))) ?? [];
      pscLookups++;
      const names = pscs.map((p) => p.name ?? '').filter(Boolean);
      if (pscs[0]?.name) pscNameByCompany.set(cono, pscs[0].name);
      pscInputs.push({ companyNumber: cono, distressed: true, pscNames: names });
    }
    pscPortfolio = buildPscPortfolio(pscInputs);
    log(`PSC: ${pscLookups} lookups over distressed owners; portfolio rollup built.`);
  }

  // Collapse the per-door signal graph into flat keyed tables ONCE (the M5
  // serialisation seam). The Companies House distress flags are OR'd across every
  // company at each owned door, the strongest Gazette/PSC-portfolio signal resolved,
  // and the churn / hot-street / empty-homes tables kept as-is. `resolveDoorSignals`
  // (patch-index-serialization.ts) then reads these tables identically whether the
  // index is live (here) or rehydrated from a published artifact in the cloud, so a
  // door scores the same in memory and after a round-trip (AC-09).
  const ownerSignalsByKey = new Map<string, ResolvedOwnerSignals>();
  for (const [key, owner] of ownerByKey) {
    let insolvent = false;
    let strikeOff = false;
    let accountsOverdue = false;
    let confstmtOverdue = false;
    let dormant = false;
    let hasCharges = false;
    let propertySic = false;
    let ownerStatus: string | undefined;
    // M10 PSC portfolio + Gazette-by-company, ORed across the door's companies.
    let pscControlsDistressed = 0;
    let pscName: string | undefined;
    let gazetteByCompany: GazetteInsolvencyEvent | undefined;
    for (const cono of owner.companyNumbers) {
      const f = chByCompany.get(cono);
      if (!f) continue;
      insolvent ||= f.insolvent;
      strikeOff ||= f.strikeOff;
      accountsOverdue ||= f.accountsOverdue;
      confstmtOverdue ||= f.confstmtOverdue;
      dormant ||= f.dormant;
      hasCharges ||= f.hasCharges;
      propertySic ||= f.propertySic;
      if (f.insolvent && !ownerStatus) ownerStatus = f.status;
      // PSC portfolio-distress rollup (approach-target name kept as metadata).
      const port = pscPortfolio.get(cono);
      if (port && port.controlsDistressed > pscControlsDistressed) {
        pscControlsDistressed = port.controlsDistressed;
        pscName = port.pscName ?? pscNameByCompany.get(cono) ?? pscName;
      } else if (!pscName) {
        pscName = pscNameByCompany.get(cono) ?? pscName;
      }
      // Gazette forced-sale notice matched by company_number (strongest join).
      const ev = gazetteIndex.byCompany.get(cono);
      if (ev) gazetteByCompany = ev;
    }
    ownerSignalsByKey.set(key, {
      isOverseas: owner.isOverseas,
      propertySic,
      insolvent,
      strikeOff,
      accountsOverdue,
      confstmtOverdue,
      dormant,
      hasCharges,
      ownerStatus,
      pscControlsDistressed: pscControlsDistressed || undefined,
      pscName,
      gazetteByCompany: gazetteByCompany
        ? { noticeType: gazetteByCompany.noticeType, daysSinceEvent: gazetteByCompany.daysSinceEvent }
        : undefined,
    });
  }

  // Exact-postcode Gazette notices (the fallback when no company_number matches).
  const gazetteByPostcode = new Map<string, ResolvedGazette>();
  for (const [k, ev] of gazetteIndex.byPostcode) {
    gazetteByPostcode.set(k, { noticeType: ev.noticeType, daysSinceEvent: ev.daysSinceEvent });
  }

  const tables: DoorSignalTables = {
    ownerSignalsByKey,
    churnByKey,
    hotByPostcode,
    gazetteByPostcode,
    areaWeights,
  };

  // Live per-door accessor: the on-market fusion (off-market-score.ts) and the stock
  // lens (below) both go through the shared resolver, so the live index and a
  // rehydrated one resolve any door identically.
  const signalsForDoor = (door: DoorRef): DoorSignals => resolveDoorSignals(tables, door);

  return {
    model,
    coreDistricts,
    dwellings,
    dwellingByJoin,
    ppsqftFor,
    signalsForDoor,
    tables,
    stats: {
      transactions: txns.length,
      companiesMatched: chByCompany.size,
      gazetteEvents: gazetteEvents.length,
      pscLookups,
    },
  };
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function computeStockScores(opts: StockScoreOptions = {}): Promise<StockScoreResult> {
  const hpiFactor = opts.hpiFactor ?? 1;
  const topN = opts.topN ?? 500;
  const minConfidence = opts.minConfidence ?? 0;
  const run = opts.run ?? 'local';
  const capturedAt = opts.capturedAt ?? '';
  const log = opts.log ?? (() => {});

  // Build the shared patch index (cohort model + per-door signals), then score
  // every standing dwelling by joining its intrinsic geometry/EPC to those signals.
  const index = await buildPatchPropensityIndex(opts);

  // 8. Score every dwelling (floor 20..500) and collect candidates.
  const stats: StockScoreStats = {
    transactions: index.stats.transactions,
    dwellingsScored: 0,
    conf60: 0,
    conf40: 0,
    companyOwned: 0,
    epcFG: 0,
    companiesMatched: index.stats.companiesMatched,
    ownerDistress: 0,
    emitted: 0,
    gazetteEvents: index.stats.gazetteEvents,
    gazetteHits: 0,
    pscLookups: index.stats.pscLookups,
    pscPortfolioHits: 0,
    areaHotspotDwellings: 0,
  };
  const scored: { input: DwellingInput; score: ReturnType<typeof scoreDwelling> }[] = [];

  for (const { d } of index.dwellings.values()) {
    if (d.floorArea < 20 || d.floorArea > 500) continue;
    stats.dwellingsScored++;
    if (d.epcGroup === 'FG') stats.epcFG++;

    const sig = index.signalsForDoor({
      postcode: d.postcode,
      paonNum: d.paonNum,
      address: d.address,
      localAuthority: d.localAuthority,
    });
    if (sig.companyOwned) stats.companyOwned++;
    if (sig.insolvent || sig.strikeOff || sig.accountsOverdue || sig.dormant) stats.ownerDistress++;
    if (sig.gazetteEvent) stats.gazetteHits++;
    if ((sig.pscControlsDistressed ?? 0) >= 2) stats.pscPortfolioHits++;
    if (sig.areaHotspot) stats.areaHotspotDwellings++;

    const input: DwellingInput = {
      address: d.address,
      postcode: d.postcode,
      district: districtOf(d.postcode),
      ptype: d.ptype,
      epc: d.epc,
      epcGroup: d.epcGroup,
      floorArea: d.floorArea,
      uprn: d.uprn,
      tenure: d.tenure,
      ...sig,
    };
    const score = scoreDwelling(input, index.model, { hpiFactor });
    if (score.confidence >= 0.6) stats.conf60++;
    if (score.confidence >= 0.4) stats.conf40++;
    scored.push({ input, score });
  }

  // 9. Emit the top-N candidates (sanity value band 40k..600k, matching the proof
  //    export), highest confidence first.
  const emit = scored
    .filter((s) => s.score.estMarketValue >= 40000 && s.score.estMarketValue <= 600000)
    .filter((s) => s.score.confidence >= minConfidence)
    .sort((a, b) => b.score.confidence - a.score.confidence || b.score.estMarketValue - a.score.estMarketValue)
    .slice(0, topN);
  const candidates = emit.map((s) => dwellingToCandidate(s.input, s.score, { run, capturedAt }));
  stats.emitted = candidates.length;

  log(
    `Scored ${stats.dwellingsScored} dwellings: ${stats.conf60} at 60%+, ${stats.conf40} at 40%+, ` +
      `${stats.companyOwned} company-owned, ${stats.epcFG} EPC F/G, ${stats.companiesMatched} companies matched; ` +
      `M10: ${stats.gazetteHits} Gazette-matched (${stats.gazetteEvents} notices), ${stats.pscPortfolioHits} PSC-portfolio, ` +
      `${stats.areaHotspotDwellings} empty-homes-hotspot; emitting ${stats.emitted}`
  );
  return { stats, candidates };
}

/**
 * Score the stock and ingest the top candidates for a specific tenant. Used by
 * the Trigger.dev task, which has no auth session - hence the explicit tenantId
 * and the additive ingestCandidatesForTenant seam (dynamically imported so the
 * pure computeStockScores layer stays free of server-action deps).
 */
export async function runDealRadarScore(
  tenantId: string,
  opts: StockScoreOptions = {}
): Promise<{ stats: StockScoreStats; ingest: { inserted: number; skipped: number; errors: number } }> {
  const { stats, candidates } = await computeStockScores(opts);
  const { ingestCandidatesForTenant } = await import('@/server/actions/lead-review');
  const summary = await ingestCandidatesForTenant(tenantId, candidates, {
    capturedFor: opts.capturedAt ? opts.capturedAt.slice(0, 10) : undefined,
  });
  return { stats, ingest: { inserted: summary.inserted, skipped: summary.skipped, errors: summary.errors.length } };
}
