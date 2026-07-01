/**
 * EPC grant-works logic (M6-T2) - pure, testable.
 *
 * Turns the EPC improvement recommendations into "what works are needed to reach
 * a C, and the indicative cost", which feeds the refurb estimate and the report.
 * The fetch lives in server/public-data/epc-recommendations.ts; the parsing and
 * selection are here so they can be unit-tested without the API.
 */

export interface EpcMeasure {
  /** Short measure name, e.g. "Increase loft insulation to 270mm". */
  summary: string;
  description?: string;
  /** Raw indicative cost string from the EPC, e.g. "£100 - £350". */
  indicativeCostText?: string;
  /** Cumulative EPC band after applying this measure (and all prior), e.g. "C". */
  resultingBand?: string;
}

export interface CostRange {
  low?: number;
  high?: number;
  mid?: number;
}

export interface GrantWorks {
  currentBand: string;
  targetBand: string;
  /** True when the property is already at the target band or better. */
  alreadyAtTarget: boolean;
  /** The ordered measures needed to reach the target (empty if already there). */
  measuresToTarget: EpcMeasure[];
  /** True when the recommendations actually reach the target band. */
  reachesTarget: boolean;
  /** Summed indicative cost of measuresToTarget. */
  cost: CostRange;
}

/** EPC bands A (best) .. G (worst); lower rank = better. */
const BAND_RANK: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7 };

export function bandRank(band?: string): number | null {
  if (!band) return null;
  const r = BAND_RANK[band.trim().toUpperCase()];
  return r ?? null;
}

/** Does `band` meet or beat `target` (e.g. C)? Unknown bands are treated as not meeting it. */
export function bandMeets(band: string | undefined, target: string): boolean {
  const b = bandRank(band);
  const t = bandRank(target);
  if (b === null || t === null) return false;
  return b <= t;
}

/**
 * Parse an EPC indicative cost string into low/high/mid.
 * Handles "£100 - £350", "£1,500 - £2,000", "£350", and empty/garbage (-> {}).
 */
export function parseIndicativeCost(text?: string): CostRange {
  if (!text) return {};
  const nums = (text.match(/[\d,]+(?:\.\d+)?/g) ?? [])
    .map((n) => Number(n.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return {};
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return { low, high, mid: Math.round((low + high) / 2) };
}

/**
 * Select the ordered prefix of measures needed to reach the target band. EPC
 * recommendations are ordered and carry the cumulative resulting band, so we
 * include measures up to and including the first that reaches the target. If
 * none reach it, all measures are returned with reachesTarget = false.
 */
export function selectMeasuresToBand(
  measures: EpcMeasure[],
  target: string,
): { measures: EpcMeasure[]; reaches: boolean } {
  const picked: EpcMeasure[] = [];
  for (const m of measures) {
    picked.push(m);
    if (bandMeets(m.resultingBand, target)) return { measures: picked, reaches: true };
  }
  return { measures: picked, reaches: false };
}

/** Sum a set of measures' indicative costs into one range. */
export function sumMeasureCosts(measures: EpcMeasure[]): CostRange {
  let low = 0;
  let high = 0;
  let any = false;
  for (const m of measures) {
    const c = parseIndicativeCost(m.indicativeCostText);
    if (c.low !== undefined) {
      low += c.low;
      high += c.high ?? c.low;
      any = true;
    }
  }
  if (!any) return {};
  return { low, high, mid: Math.round((low + high) / 2) };
}

/**
 * Summarise the works + cost to reach a target band (default C). When the
 * property is already at or above the target, returns no measures and zero cost.
 */
export function summariseGrantWorks(
  currentBand: string,
  measures: EpcMeasure[],
  target = 'C',
): GrantWorks {
  if (bandMeets(currentBand, target)) {
    return {
      currentBand,
      targetBand: target,
      alreadyAtTarget: true,
      measuresToTarget: [],
      reachesTarget: true,
      cost: { low: 0, high: 0, mid: 0 },
    };
  }
  const { measures: measuresToTarget, reaches } = selectMeasuresToBand(measures, target);
  return {
    currentBand,
    targetBand: target,
    alreadyAtTarget: false,
    measuresToTarget,
    reachesTarget: reaches,
    cost: sumMeasureCosts(measuresToTarget),
  };
}
