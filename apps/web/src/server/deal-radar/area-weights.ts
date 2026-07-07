/**
 * Deal Radar area-level cohort weights (M10).
 *
 * The Council Taxbase (CTB) return publishes, per local authority, the count of
 * long-term empty dwellings and the count charged the empty-homes premium (up to
 * 400% council tax). A heavy empty-homes overhang means a thinner buyer pool and
 * longer time-to-sell, so owners in that area concede more readily. This turns
 * that per-LA overhang into a COHORT weight: a multiplier (>= 1) applied to a
 * dwelling's cohort base rate before the noisy-OR, plus a hotspot flag that
 * surfaces the plain-English "empty-homes hotspot LA" reason.
 *
 * Pure and unit-tested. No IO here: buildAreaWeightTable takes already-parsed
 * per-LA rows (the ingest worker reads the CTB file fail-soft and hands them in,
 * or hands in nothing, in which case every multiplier is a neutral 1.0). The
 * area weight only ever LIFTS a score (floored at 1.0); it never suppresses a
 * genuine property-level distress signal.
 */

/** One local-authority row from the Council Taxbase empty-homes return. */
export type TaxbaseRow = {
  localAuthority: string;
  /** Total chargeable dwellings on the taxbase (denominator for the empty rate). */
  dwellings: number;
  /** Long-term empty dwellings. */
  longTermEmpty: number;
  /** Dwellings charged the empty-homes premium. */
  premiumCharged: number;
};

/** The computed weight for one local authority. */
export type AreaWeight = {
  localAuthority: string;
  /** Long-term empties as a share of chargeable dwellings. */
  emptyRate: number;
  /** Multiplier applied to the cohort base rate (>= 1). */
  multiplier: number;
  /** True when the area's empty-homes overhang is materially above the cohort median. */
  hotspot: boolean;
};

export type AreaWeightTable = Map<string, AreaWeight>;

export type AreaWeightOptions = {
  /** Extra multiplier per unit of (emptyRate / medianRate - 1). Default 0.2. */
  upliftSlope?: number;
  /** Hard cap on the multiplier. Default 1.35. */
  maxMultiplier?: number;
  /** emptyRate / medianRate at/above which an LA is a hotspot. Default 1.5. */
  hotspotRatio?: number;
};

const DEFAULT_UPLIFT_SLOPE = 0.2;
const DEFAULT_MAX_MULTIPLIER = 1.35;
const DEFAULT_HOTSPOT_RATIO = 1.5;

/** Normalise a local-authority name to a stable lookup key. */
export function normaliseLaName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Build the per-LA weight table from Council Taxbase rows. The cohort baseline is
 * the median empty rate across the supplied LAs; an LA at the median weighs 1.0,
 * an LA with a heavier overhang lifts (capped), and a materially-above-median LA
 * is flagged a hotspot. An empty input yields an empty table (all lookups then
 * return the neutral 1.0 / false defaults).
 */
export function buildAreaWeightTable(rows: TaxbaseRow[], opts: AreaWeightOptions = {}): AreaWeightTable {
  const upliftSlope = opts.upliftSlope ?? DEFAULT_UPLIFT_SLOPE;
  const maxMultiplier = opts.maxMultiplier ?? DEFAULT_MAX_MULTIPLIER;
  const hotspotRatio = opts.hotspotRatio ?? DEFAULT_HOTSPOT_RATIO;

  const withRate = rows
    .filter((r) => r.dwellings > 0)
    .map((r) => ({ row: r, emptyRate: r.longTermEmpty / r.dwellings }));

  const medianRate = median(withRate.map((r) => r.emptyRate));

  const table: AreaWeightTable = new Map();
  for (const { row, emptyRate } of withRate) {
    const ratio = medianRate > 0 ? emptyRate / medianRate : 1;
    const multiplier = Math.min(maxMultiplier, Math.max(1, 1 + upliftSlope * (ratio - 1)));
    const hotspot = medianRate > 0 && ratio >= hotspotRatio;
    table.set(normaliseLaName(row.localAuthority), {
      localAuthority: row.localAuthority,
      emptyRate,
      multiplier,
      hotspot,
    });
  }
  return table;
}

/** Base-rate multiplier for a local authority (neutral 1.0 when unknown). */
export function areaMultiplierFor(table: AreaWeightTable, localAuthority: string | undefined): number {
  if (!localAuthority) return 1;
  return table.get(normaliseLaName(localAuthority))?.multiplier ?? 1;
}

/** Whether a local authority is an empty-homes hotspot (false when unknown). */
export function isEmptyHomesHotspot(table: AreaWeightTable, localAuthority: string | undefined): boolean {
  if (!localAuthority) return false;
  return table.get(normaliseLaName(localAuthority))?.hotspot ?? false;
}
