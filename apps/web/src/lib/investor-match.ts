/**
 * Lead-to-client matching (BSE-OPP-P01 M1 - the moonshot core).
 *
 * Pure + client-safe (no directives, no server imports) so it runs in the
 * matching pass at ingest AND can be unit tested without a database. It scores
 * one lead against every investor in the network store and returns the ranked
 * matches, so the review inbox can show "N% fit for [Investor], because ..."
 * instead of a criteria-less "0% fit".
 *
 * It reuses `scoreLeadFit` verbatim: an investor's criteria are the same shape
 * as a Deal's own `criteria`, so matching a lead against an investor is just
 * scoring the lead's property/financials with that investor's criteria swapped
 * in. No second scoring model to keep in sync.
 */

import type { Deal } from './deal-store';
import { emptyDeal } from './deal-factory';
import { scoreLeadFit } from './lead-score';
import {
  candidateToDealInput,
  type ScrapedCandidate,
  type LeadMatchSummary,
} from './lead-intake';

/**
 * An investor's brief, as held in the network criteria store. The four scored
 * fields mirror `Deal.criteria` exactly (free text: budget "£350,000",
 * target_yield "7%", areas a comma list) so they drop straight into
 * scoreLeadFit. `strategy`/`notes` are context, not scored (yet).
 */
export type InvestorCriteria = {
  id: string;
  name: string;
  budget?: string | null;
  areas?: string | null;
  propertyType?: string | null;
  targetYield?: string | null;
  strategy?: string | null;
  notes?: string | null;
};

/** One investor's score against a lead. */
export type LeadMatch = {
  investorId: string;
  investorName: string;
  pct: number;            // 0..100 from scoreLeadFit
  met: number;            // criteria met
  applicable: number;     // criteria scorable (both sides had data)
  reasons: { ok: boolean; text: string }[];
};

/** The outcome of matching one lead against the whole store. */
export type MatchOutcome = {
  /** Highest-scoring investor with at least one scorable criterion, or null. */
  best: LeadMatch | null;
  /** Every scorable investor, best first (ties broken by criteria met). */
  ranked: LeadMatch[];
  /** True when the best match cleared the fit floor. */
  matched: boolean;
};

/**
 * A lead is "matched" to its best investor when that investor scored above this
 * floor. 0 means "at least one criterion met" is enough to surface a match;
 * below it the lead is shown but flagged unmatched. Kept as a named constant so
 * it is easy to tune with the partner (a PLAN risk: weak matches erode trust).
 */
export const MATCH_FLOOR_PCT = 1;

/** Map an investor's brief onto the Deal.criteria shape scoreLeadFit reads. */
function toDealCriteria(inv: InvestorCriteria): Deal['criteria'] {
  return {
    budget: inv.budget ?? '',
    areas: inv.areas ?? '',
    propertyType: inv.propertyType ?? '',
    targetYield: inv.targetYield ?? '',
    refurbTolerance: '',
    epcRequirement: '',
    timeline: '',
  };
}

/**
 * Score a lead (as a draft Deal) against every investor. Investors with no
 * scorable criterion for this lead (a blank brief, or no overlap) are dropped -
 * they cannot honestly be called a match. The rest rank by fit %, then by the
 * raw count of criteria met so a 2-of-2 beats a 1-of-1 on the same percentage.
 */
export function matchLeadToClients(
  deal: Deal,
  investors: InvestorCriteria[]
): MatchOutcome {
  const ranked: LeadMatch[] = investors
    .map((inv) => {
      const scored = scoreLeadFit({ ...deal, criteria: toDealCriteria(inv) });
      return {
        investorId: inv.id,
        investorName: inv.name,
        pct: scored.pct,
        met: scored.met,
        applicable: scored.applicable,
        reasons: scored.reasons,
      };
    })
    .filter((m) => m.applicable > 0)
    .sort((a, b) => (b.pct - a.pct) || (b.met - a.met));

  const best = ranked[0] ?? null;
  const matched = !!best && best.pct >= MATCH_FLOOR_PCT;
  return { best, ranked, matched };
}

/**
 * Match a scraped candidate (pre-Deal) against the store. Builds the same draft
 * Deal `fitForCandidate` uses, then delegates to matchLeadToClients. This is the
 * entry point the ingestion pass calls per candidate.
 */
export function matchCandidateToClients(
  raw: ScrapedCandidate,
  investors: InvestorCriteria[]
): MatchOutcome {
  const { address, initialInputs } = candidateToDealInput(raw);
  // Seed the draft with the composed address too - scoreLeadFit's area check
  // reads deal.address, which lives outside initialInputs.
  const draft = emptyDeal('lc-draft', { ...initialInputs, address });
  return matchLeadToClients(draft, investors);
}

/**
 * Reduce a full MatchOutcome to the compact LeadMatchSummary persisted on the
 * candidate row and read by the review card. Reasons are the met criteria in
 * plain English (the "because ..." line); when nothing was met we fall back to
 * the unmet reasons so the card still explains the closest miss.
 */
export function summariseMatch(outcome: MatchOutcome): LeadMatchSummary {
  const best = outcome.best;
  if (!best) {
    return { matched: false, pct: 0, reasons: [] };
  }

  const metReasons = best.reasons.filter((r) => r.ok).map((r) => r.text);
  const reasons = metReasons.length > 0 ? metReasons : best.reasons.map((r) => r.text);

  const alternatives = outcome.ranked
    .slice(1, 3)
    .map((m) => ({ name: m.investorName, pct: m.pct }));

  return {
    matched: outcome.matched,
    investorId: best.investorId,
    investorName: best.investorName,
    pct: best.pct,
    reasons,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}
