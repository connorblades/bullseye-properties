/**
 * Deal Radar scoring model (M8, pure core).
 *
 * A faithful TypeScript port of the proven DuckDB proof engine
 * (rdr_phaseA/BC/E in the Deal Radar concept doc). No IO, no DB, no server
 * imports - it takes already-aggregated typed inputs and returns a
 * motivated-seller propensity score, so it is unit-testable in isolation and
 * reusable by the streaming worker (ingest-stock.ts).
 *
 * The score is a probability that the OWNER would accept a below-market offer,
 * not a valuation. It starts from a size-normalised cohort discount rate learned
 * from Land Registry Price Paid + EPC floor areas, then lifts that base rate by
 * property-specific motivation signals (EPC condition, corporate/overseas
 * ownership, private-rental tenure, hot-street effect, prior loss-resale/churn)
 * and Companies House owner-distress signals, combined as independent routes to
 * a discount (noisy-OR). Every route contributes a ranked plain-English reason
 * so any resulting offer is defensible.
 *
 * The one deliberate divergence from the proof: est_market_value is HPI-adjusted
 * (a scalar factor, seam for the local HPI series) and rounded to the nearest
 * GBP 5,000, per AC-15. The confidence maths and the base-rate learning are
 * unchanged from the proof, so the yardstick counts are preserved.
 */

import type { ScrapedCandidate } from '@/lib/lead-intake';

/** Land Registry property-type code: Detached, Semi, Terraced, Flat/maisonette. */
export type PropertyType = 'D' | 'S' | 'T' | 'F';

/** EPC condition band group: F/G (severe/MEES), D/E, A/B/C, or unknown. */
export type EpcGroup = 'FG' | 'DE' | 'ABC' | 'UNK';

/**
 * One Land Registry sale joined to its EPC floor area. The learning row the
 * cohort model is fitted on (ppd_cat 'A', price 10k..2M, floor 20..500sqm).
 */
export type SoldObservation = {
  /** Postcode district, e.g. "S80" (regexp ^[A-Z]+[0-9]+ of the postcode). */
  district: string;
  ptype: PropertyType;
  epcGroup: EpcGroup;
  floorArea: number;
  price: number;
};

/** Per-cohort aggregate: sample size, discount rate, and median discount depth. */
export type CohortStat = {
  /** Number of learning rows in the cell/cohort. */
  n: number;
  /** Share of sales that completed at 15%+ below their size-normalised value. */
  rate: number;
  /** Median discount depth (1 - price/refValue) over the discounted sales, or null. */
  depth: number | null;
};

/**
 * The learned cohort model. Keys are joined strings:
 *   ppsqftByCohort  `${district}|${ptype}`          -> median price-per-sqft (n>=30)
 *   ppsqftByDistrict `${district}`                  -> median price-per-sqft (fallback)
 *   cellRate        `${district}|${ptype}|${epcGroup}` -> CohortStat
 *   cohortRate      `${district}|${ptype}`          -> CohortStat
 */
export type CohortModel = {
  ppsqftByCohort: Map<string, number>;
  ppsqftByDistrict: Map<string, number>;
  cellRate: Map<string, CohortStat>;
  cohortRate: Map<string, CohortStat>;
};

/** A standing dwelling to score, with whatever signals were joined onto it. */
export type DwellingInput = {
  address: string;
  postcode: string;
  district: string;
  ptype: PropertyType;
  epc: string;
  epcGroup: EpcGroup;
  floorArea: number;
  uprn?: string;
  tenure?: string;
  // Ownership signals (HMLR CCOD/OCOD)
  companyOwned?: boolean;
  isOverseas?: boolean;
  propertySic?: boolean;
  // Property-level distress (Land Registry churn)
  churned?: boolean;
  resoldLoss?: boolean;
  streetDisc?: number; // hot-street discounted-sales share 0..1, else undefined
  // Companies House owner-distress signals
  insolvent?: boolean;
  strikeOff?: boolean;
  accountsOverdue?: boolean;
  confstmtOverdue?: boolean;
  dormant?: boolean;
  hasCharges?: boolean;
  ownerStatus?: string; // raw CH status text, for the "OWNER INSOLVENT (...)" reason
  // M10 distress-signal expansion (all fail-soft; absent when a source is down)
  /** A Gazette forced-sale notice joined to this door/company (winding-up etc). */
  gazetteEvent?: boolean;
  /** Short Gazette notice type, e.g. "winding-up" (drives the reason wording). */
  gazetteNoticeType?: string;
  /** Whole days since the Gazette notice was published, when known. */
  gazetteDaysSince?: number;
  /** How many DISTRESSED companies the owner's PSC also controls (portfolio motivation). */
  pscControlsDistressed?: number;
  /** Owner's PSC name (approach-target metadata only, on a company-keyed lead). */
  pscName?: string;
  // M10 area-level cohort weight (Council Taxbase empty-homes premium)
  /** Multiplier applied to the cohort base rate (>= 1; default 1 = no effect). */
  areaMultiplier?: number;
  /** True when the local authority is an empty-homes hotspot (drives the reason). */
  areaHotspot?: boolean;
};

/** The scored output for a dwelling. */
export type DwellingScore = {
  /** Motivated-seller probability 0..1, rounded to 4dp. */
  confidence: number;
  /** Ranked, plain-English reasons (strongest route first). */
  reasons: string[];
  /** Size-normalised, HPI-adjusted market value, rounded to nearest GBP 5,000. */
  estMarketValue: number;
  /** Value less the cohort's historic concession, rounded to nearest GBP 5,000. */
  estAchievable: number;
  /** The size-normalised cohort discount base rate used (pre-signals). */
  baseRate: number;
};

// ── Noisy-OR route weights (ported verbatim from rdr_phaseE) ──────────────────
// Each is an independent probability that this single signal, on its own, tips
// the owner into conceding. Combined multiplicatively as 1 - product(1 - w).
const W = {
  epcFG: 0.25,
  epcDE: 0.07,
  companyOwned: 0.12,
  overseas: 0.1,
  rental: 0.1,
  streetDisc: 0.2, // scaled by the street's own discounted share
  resoldLoss: 0.3,
  churned: 0.1,
  insolvent: 0.4,
  strikeOff: 0.28,
  accountsOverdue: 0.18,
  confstmtOverdue: 0.08,
  dormant: 0.12,
  hasCharges: 0.08,
  // M10: a dated Gazette forced-sale notice is the single clearest signal, above
  // even a bare Companies House "insolvent" status flag.
  gazetteEvent: 0.45,
  // M10: a PSC controlling several distressed companies (portfolio unwinding).
  pscPortfolio: 0.15,
} as const;

/** A PSC portfolio-distress route fires only when the person controls 2+ distressed cos. */
const PSC_PORTFOLIO_MIN = 2;

/** Base rate is capped so a single cohort can never dominate the noisy-OR. */
const BASE_RATE_CAP = 0.6;
/** Fallbacks when a cohort has no learned rate/depth. */
const DEFAULT_BASE_RATE = 0.15;
const DEFAULT_DEPTH = 0.2;
/** A learning cell needs this many rows before its own rate is trusted. */
const CELL_MIN_N = 20;
/** A (district,ptype) cohort needs this many rows for its own price-per-sqft. */
const PPSQFT_MIN_N = 30;

/** Median of a numeric array (mean of the two middle values for even length). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Round to the nearest GBP 5,000. */
export function round5k(value: number): number {
  return Math.round(value / 5000) * 5000;
}

/** Round to 4 decimal places (matches the proof's confidence precision). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

const cohortKey = (district: string, ptype: string) => `${district}|${ptype}`;
const cellKey = (district: string, ptype: string, epcGroup: string) =>
  `${district}|${ptype}|${epcGroup}`;

/**
 * Learn the cohort model from the sold+EPC observations.
 *
 * 1. Median price-per-sqft per (district,ptype) with >=30 rows, plus a
 *    district-level fallback median.
 * 2. For each sale, a size-normalised reference value = floorArea x ppsqft
 *    (cohort ppsqft, else district ppsqft). Sales with no ppsqft are dropped.
 * 3. Discount rate + median depth per (district,ptype,epcGroup) cell and per
 *    (district,ptype) cohort, where "discounted" = price <= 85% of refValue.
 */
export function computeCohortBaseRate(sold: SoldObservation[]): CohortModel {
  // Group price-per-sqft observations.
  const ppsqftCohortObs = new Map<string, number[]>();
  const ppsqftDistrictObs = new Map<string, number[]>();
  for (const s of sold) {
    if (s.floorArea <= 0) continue;
    const ppsqft = s.price / s.floorArea;
    const ck = cohortKey(s.district, s.ptype);
    (ppsqftCohortObs.get(ck) ?? ppsqftCohortObs.set(ck, []).get(ck)!).push(ppsqft);
    (ppsqftDistrictObs.get(s.district) ?? ppsqftDistrictObs.set(s.district, []).get(s.district)!).push(ppsqft);
  }

  const ppsqftByCohort = new Map<string, number>();
  for (const [key, obs] of ppsqftCohortObs) {
    if (obs.length >= PPSQFT_MIN_N) {
      const m = median(obs);
      if (m != null) ppsqftByCohort.set(key, m);
    }
  }
  const ppsqftByDistrict = new Map<string, number>();
  for (const [key, obs] of ppsqftDistrictObs) {
    const m = median(obs);
    if (m != null) ppsqftByDistrict.set(key, m);
  }

  // Accumulate discount outcomes per cell and per cohort.
  type Acc = { total: number; discounted: number; depths: number[] };
  const cellAcc = new Map<string, Acc>();
  const cohortAcc = new Map<string, Acc>();
  const bump = (map: Map<string, Acc>, key: string, isDisc: boolean, depth: number) => {
    let a = map.get(key);
    if (!a) map.set(key, (a = { total: 0, discounted: 0, depths: [] }));
    a.total++;
    if (isDisc) {
      a.discounted++;
      a.depths.push(depth);
    }
  };

  for (const s of sold) {
    const ppsqft = ppsqftByCohort.get(cohortKey(s.district, s.ptype)) ?? ppsqftByDistrict.get(s.district);
    if (ppsqft == null) continue;
    const refValue = s.floorArea * ppsqft;
    if (refValue <= 0) continue;
    const isDisc = s.price <= 0.85 * refValue;
    const depth = 1 - s.price / refValue;
    bump(cellAcc, cellKey(s.district, s.ptype, s.epcGroup), isDisc, depth);
    bump(cohortAcc, cohortKey(s.district, s.ptype), isDisc, depth);
  }

  const toStat = (acc: Map<string, Acc>): Map<string, CohortStat> => {
    const out = new Map<string, CohortStat>();
    for (const [key, a] of acc) {
      out.set(key, { n: a.total, rate: a.total > 0 ? a.discounted / a.total : 0, depth: median(a.depths) });
    }
    return out;
  };

  return {
    ppsqftByCohort,
    ppsqftByDistrict,
    cellRate: toStat(cellAcc),
    cohortRate: toStat(cohortAcc),
  };
}

/** Human-readable property type for a candidate. */
export function propertyTypeLabel(ptype: PropertyType): string {
  switch (ptype) {
    case 'D':
      return 'Detached';
    case 'S':
      return 'Semi-detached';
    case 'T':
      return 'Terraced';
    case 'F':
      return 'Flat';
  }
}

/**
 * Score a single dwelling. Returns the noisy-OR confidence, the ranked reasons,
 * and the HPI-adjusted value/achievable estimates.
 *
 * @param opts.hpiFactor scalar applied to the cohort value to bring it to
 *   today's money (seam for the local HPI series; default 1 = no adjustment).
 */
export function scoreDwelling(
  d: DwellingInput,
  model: CohortModel,
  opts: { hpiFactor?: number } = {}
): DwellingScore {
  const hpiFactor = opts.hpiFactor ?? 1;

  const ppsqft =
    model.ppsqftByCohort.get(cohortKey(d.district, d.ptype)) ?? model.ppsqftByDistrict.get(d.district);
  const marketRaw = ppsqft != null && d.floorArea > 0 ? d.floorArea * ppsqft * hpiFactor : undefined;

  const cell = model.cellRate.get(cellKey(d.district, d.ptype, d.epcGroup));
  const cohort = model.cohortRate.get(cohortKey(d.district, d.ptype));

  const baseRate = cell && cell.n >= CELL_MIN_N ? cell.rate : cohort?.rate ?? DEFAULT_BASE_RATE;
  const depth =
    cell && cell.n >= CELL_MIN_N && cell.depth != null ? cell.depth : cohort?.depth ?? DEFAULT_DEPTH;

  const rental = (d.tenure ?? '').toLowerCase().includes('rental');
  const pscPortfolio = (d.pscControlsDistressed ?? 0) >= PSC_PORTFOLIO_MIN;

  // Noisy-OR: 1 - product of (1 - route weight), base rate first (capped). The
  // area-level empty-homes weight lifts the cohort base rate before the cap; it
  // only ever raises the effective base rate (areaMultiplier >= 1).
  const areaMultiplier = d.areaMultiplier ?? 1;
  let survive = 1 - Math.min(baseRate * areaMultiplier, BASE_RATE_CAP);
  const route = (active: boolean | undefined, weight: number) => {
    if (active) survive *= 1 - weight;
  };
  route(d.gazetteEvent, W.gazetteEvent);
  route(pscPortfolio, W.pscPortfolio);
  route(d.epcGroup === 'FG', W.epcFG);
  route(d.epcGroup === 'DE', W.epcDE);
  route(d.companyOwned, W.companyOwned);
  route(d.isOverseas, W.overseas);
  route(rental, W.rental);
  if (d.streetDisc != null) survive *= 1 - Math.min(d.streetDisc, 1) * W.streetDisc;
  if (d.resoldLoss) survive *= 1 - W.resoldLoss;
  else route(d.churned, W.churned);
  route(d.insolvent, W.insolvent);
  route(d.strikeOff, W.strikeOff);
  route(d.accountsOverdue, W.accountsOverdue);
  route(d.confstmtOverdue, W.confstmtOverdue);
  route(d.dormant, W.dormant);
  route(d.hasCharges, W.hasCharges);
  const confidence = round4(1 - survive);

  // Ranked reasons, strongest route first (mirrors the proof's reason string).
  const reasons: string[] = [];
  if (d.gazetteEvent) {
    const type = d.gazetteNoticeType ?? 'insolvency notice';
    reasons.push(
      d.gazetteDaysSince != null ? `Gazette ${type} ${d.gazetteDaysSince} days ago` : `Gazette ${type}`
    );
  }
  if (d.insolvent) reasons.push(`OWNER INSOLVENT (${d.ownerStatus ?? 'insolvency'})`);
  if (pscPortfolio) reasons.push(`PSC controls ${d.pscControlsDistressed} distressed cos`);
  if (d.strikeOff) reasons.push('owner strike-off pending');
  if (d.accountsOverdue) reasons.push('owner accounts overdue');
  if (d.dormant) reasons.push('owner company dormant');
  if (d.hasCharges) reasons.push('owner has secured debt');
  if (d.epcGroup === 'FG') reasons.push(`EPC ${d.epc} severe/MEES`);
  else if (d.epcGroup === 'DE') reasons.push(`EPC ${d.epc}`);
  if (d.companyOwned && d.isOverseas) reasons.push('overseas-company owned');
  else if (d.companyOwned && d.propertySic) reasons.push('property-company owned');
  else if (d.companyOwned) reasons.push('company owned');
  if (rental) reasons.push('landlord/BTL');
  if (d.streetDisc != null) reasons.push(`hot street ${Math.round(d.streetDisc * 100)}%`);
  if (d.resoldLoss) reasons.push('prior loss-resale');
  else if (d.churned) reasons.push('repeat-sold');
  if (d.areaHotspot) reasons.push('empty-homes hotspot LA');
  reasons.push(`cohort ${Math.round(baseRate * 100).toFixed(1)}% sell 15%+ under`);

  const estMarketValue = marketRaw != null ? round5k(marketRaw) : 0;
  const estAchievable = marketRaw != null ? round5k(marketRaw * (1 - depth)) : 0;

  return { confidence, reasons, estMarketValue, estAchievable, baseRate };
}

/**
 * Turn a scored dwelling into the emit-contract ScrapedCandidate (channel
 * 'open-data', historic lens: no asking/guide price). The radar block carries
 * the confidence, ranked reasons, and the two value estimates.
 */
export function dwellingToCandidate(
  d: DwellingInput,
  score: DwellingScore,
  ctx: { run: string; capturedAt: string }
): ScrapedCandidate {
  const ref = d.uprn && d.uprn.trim() ? d.uprn.trim() : `${d.postcode}:${d.address}`;
  return {
    address: d.address,
    postcode: d.postcode,
    propertyType: propertyTypeLabel(d.ptype),
    tenure: d.tenure,
    epcRating: d.epc,
    channel: 'open-data',
    sourceRef: `rdr:${ctx.run}:${ref}`,
    capturedAt: ctx.capturedAt,
    radar: {
      discountConfidence: score.confidence,
      discountReasons: score.reasons,
      estMarketValue: score.estMarketValue,
      estAchievable: score.estAchievable,
      // Approach-target metadata only, on an already company-keyed lead (M10).
      approachTarget: d.companyOwned ? d.pscName : undefined,
    },
  };
}

/** Classify an EPC current-rating letter into its condition group. */
export function epcGroupOf(rating: string): EpcGroup {
  const r = rating.trim().toUpperCase();
  if (r === 'F' || r === 'G') return 'FG';
  if (r === 'D' || r === 'E') return 'DE';
  if (r === 'A' || r === 'B' || r === 'C') return 'ABC';
  return 'UNK';
}

/**
 * Classify an EPC PROPERTY_TYPE + BUILT_FORM into a Land Registry ptype, or null
 * when it maps to neither (mirrors the proof's ptype CASE). Flats/maisonettes
 * are 'F' regardless of built form.
 */
export function ptypeOf(propertyType: string, builtForm: string): PropertyType | null {
  const pt = propertyType.trim().toUpperCase();
  const bf = builtForm.trim().toUpperCase();
  if (pt === 'FLAT' || pt === 'MAISONETTE') return 'F';
  if (bf === 'DETACHED') return 'D';
  if (bf === 'SEMI-DETACHED') return 'S';
  if (bf.includes('TERRACE')) return 'T';
  return null;
}

/** Leading-digits house number from an address (paon), or '' when absent. */
export function leadingNumber(text: string): string {
  const m = text.trim().match(/^[0-9]+/);
  return m ? m[0] : '';
}
