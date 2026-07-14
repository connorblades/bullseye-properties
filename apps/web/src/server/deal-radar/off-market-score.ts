/**
 * In-platform off-market negotiability scorer (BSE-OPP-P01 M3, AC-06).
 *
 * Fuses the Deal Radar historic propensity lens onto an ON-MARKET listing so that
 * even a full-asking listing carries a probability its owner would accept a
 * below-market offer, with ranked reasons (cohort base rate, EPC condition,
 * corporate/overseas ownership, empty-homes overhang, and fail-soft distress
 * signals). This is distinct from the M2 discount score: discount is
 * listing-vs-comp; negotiability is owner-propensity, and it fires whether or not
 * the listing is discounted.
 *
 * It is deliberately thin and pure: it derives the listing's district / property
 * type / EPC group, joins the listing to a known door in the shared patch index
 * (server/deal-radar/ingest-stock.ts::buildPatchPropensityIndex) when one exists -
 * pulling that door's EPC, floor area, tenure and every owner/distress signal - and
 * reuses scoreDwelling verbatim (identical maths to the standing-stock lens). Only
 * the index type is imported (the runtime builder streams the multi-GB files and is
 * dynamically imported by the caller), so this module stays free of node:fs and is
 * unit-testable with a hand-built index.
 *
 * Local-first + fail-soft: the caller builds the index inside a try/catch and skips
 * scoring when the ~4.7GB Land Registry / EPC files are absent (the cloud-hosting
 * follow-up); a listing that joins no learned cohort simply returns null and is
 * still ingested un-enriched. Person-level (deceased-estates / PSC) sources stay
 * behind their existing env gates in the index build, off by default.
 */

import type { CandidateRadar, LeadMarket, NegotiabilityScore, ScrapedCandidate } from '@/lib/lead-intake';
import type { PatchPropensityIndex } from './ingest-stock';
import { scoreDwelling, epcGroupOf, leadingNumber, type DwellingInput, type PropertyType } from './score';

export type OffMarketScore = {
  negotiability: NegotiabilityScore;
};

export type OffMarketScoreOptions = {
  /** Scalar HPI adjustment applied to the size-normalised estimated value (default 1). */
  hpiFactor?: number;
};

/** Postcode district: leading letters + digits, e.g. "S80 2RE" -> "S80". */
function districtOf(postcode: string): string {
  return (postcode.toUpperCase().match(/^[A-Z]+[0-9]+/) ?? [''])[0];
}

/**
 * Map a listing's free-text property-type label ("Semi-detached house", "Terraced",
 * "2 bed flat") onto a Land Registry ptype, or null when it matches none. Order
 * matters: "semi-detached" contains "detached", so semi is tested first.
 */
export function ptypeFromLabel(label: string | undefined): PropertyType | null {
  const t = (label ?? '').trim().toUpperCase();
  if (!t) return null;
  if (/FLAT|MAISONETTE|APARTMENT/.test(t)) return 'F';
  if (/SEMI/.test(t)) return 'S';
  if (/TERRACE/.test(t)) return 'T';
  if (/DETACHED/.test(t)) return 'D';
  return null;
}

/**
 * Score one candidate's off-market negotiability against the patch index. Returns
 * the negotiability block when the listing joins a LEARNED cohort (a district +
 * property type the model actually saw), else null - so a listing outside the
 * patch, or one whose type we can't classify, is left un-enriched rather than
 * scored off the fallback base rate.
 */
export function scoreOffMarketPropensity(
  c: ScrapedCandidate,
  index: PatchPropensityIndex,
  opts: OffMarketScoreOptions = {}
): OffMarketScore | null {
  const postcode = (c.postcode ?? '').trim().toUpperCase();
  if (!postcode) return null;

  const district = districtOf(postcode);
  const ptype = ptypeFromLabel(c.propertyType);
  if (!district || !ptype) return null;

  const epcFromListing = epcGroupOf(c.epcRating ?? '');

  // Require a real cohort join: the (district,ptype) cohort or the finer
  // (district,ptype,epcGroup) cell must have been learned, else scoreDwelling would
  // fall back to DEFAULT_BASE_RATE and we'd emit a misleading "cohort 15%" for every
  // listing anywhere. The door's own EPC group (when joined) is the more specific
  // cell, so test both the listing-EPC cell and the door-EPC cell.
  const paonNum = leadingNumber(c.address ?? '');
  const door = paonNum ? index.dwellingByJoin.get(`${postcode}|${paonNum}|${ptype}`) : undefined;
  const epcGroup = door ? door.epcGroup : epcFromListing;

  const hasCohort =
    index.model.cohortRate.has(`${district}|${ptype}`) ||
    index.model.cellRate.has(`${district}|${ptype}|${epcGroup}`) ||
    index.model.cellRate.has(`${district}|${ptype}|${epcFromListing}`);
  if (!hasCohort) return null;

  const address = door?.address ?? (c.address ?? '');
  const signals = index.signalsForDoor({
    postcode,
    paonNum,
    address,
    localAuthority: door?.localAuthority,
  });

  const input: DwellingInput = {
    address,
    postcode,
    district,
    ptype,
    epc: door ? door.epc : (c.epcRating ?? '').trim().toUpperCase(),
    epcGroup,
    // Floor area is known only for a door that appears in the EPC data; without it
    // scoreDwelling still returns the propensity + reasons, just no value estimate.
    floorArea: door ? door.floorArea : 0,
    uprn: door?.uprn,
    tenure: door?.tenure ?? c.tenure,
    ...signals,
  };

  const score = scoreDwelling(input, index.model, { hpiFactor: opts.hpiFactor });

  const negotiability: NegotiabilityScore = {
    probability: score.confidence,
    reasons: score.reasons,
    baseRate: score.baseRate,
    ...(score.estMarketValue > 0 ? { estMarketValue: score.estMarketValue } : {}),
  };
  return { negotiability };
}

/**
 * True when a candidate should be fused with an off-market negotiability score:
 * it is an on-market listing that does NOT already carry one. Off-market /
 * open-data leads from the historic lens already ARE propensity leads (their
 * discountConfidence is the propensity), so they are skipped. `market` is the
 * resolved tag from the caller.
 */
export function needsPropensityScore(c: ScrapedCandidate, market: LeadMarket): boolean {
  if (market !== 'on-market') return false;
  const neg = (c.radar as CandidateRadar | undefined)?.negotiability;
  return !(neg && typeof neg.probability === 'number' && Number.isFinite(neg.probability));
}
