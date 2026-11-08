import 'server-only';

// Trusted internal worker entry point. Web callers must use the authenticated
// action or the bearer-token ingress route; never export this from 'use server'.
import { revalidatePath } from 'next/cache';
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals, leadCandidates } from '@/server/db/schema';
import { listActiveInvestorCriteriaForTenant } from '@/server/investor-criteria/store';
import {
  normaliseCandidate, dedupeKey, leadMarket, toLeadSourceMeta, mergeStoredCandidate,
  type ScrapedCandidate, type StoredCandidate,
} from '@/lib/lead-intake';
import { matchCandidateToClients, summariseMatch } from '@/lib/investor-match';

export type IngestSummary = {
  /** New physical doors inserted as pending candidates. */
  inserted: number;
  /** Existing doors that gained a NEW source via cross-source merge (M2). */
  merged: number;
  /** No-ops: empty keys, doors already promoted to a deal, idempotent re-posts. */
  skipped: number;
  errors: { address: string; reason: string }[];
};

export type IngestOptions = {
  /** Override the capture date (defaults to today, YYYY-MM-DD). */
  capturedFor?: string;
  /**
   * In-platform on-market discount threshold 0..1 (per-tenant seam; M2). Defaults
   * to RDR_ONMARKET_DISCOUNT_THRESHOLD, else the matcher default (0.85 = 15% below).
   */
  discountThreshold?: number;
  /**
   * Scalar HPI factor applied to in-platform estimated values (M3 local HPI seam).
   * Defaults to RDR_HPI_FACTOR, else 1 (no adjustment).
   */
  hpiFactor?: number;
};

/** The tunable on-market discount threshold: explicit opt, else env, else matcher default. */
function resolveDiscountThreshold(opts?: IngestOptions): number | undefined {
  if (typeof opts?.discountThreshold === 'number' && Number.isFinite(opts.discountThreshold)) {
    return opts.discountThreshold;
  }
  const env = Number(process.env.RDR_ONMARKET_DISCOUNT_THRESHOLD);
  return Number.isFinite(env) && env > 0 && env <= 1 ? env : undefined;
}

/**
 * The scalar HPI factor applied to in-platform estimated values (M3): the local
 * HPI seam that brings a size-normalised cohort/comp value to today's money.
 * Explicit opt, else RDR_HPI_FACTOR, else 1 (no adjustment - the existing default).
 */
function resolveHpiFactor(opts?: IngestOptions): number {
  if (typeof opts?.hpiFactor === 'number' && Number.isFinite(opts.hpiFactor) && opts.hpiFactor > 0) {
    return opts.hpiFactor;
  }
  const env = Number(process.env.RDR_HPI_FACTOR);
  return Number.isFinite(env) && env > 0 ? env : 1;
}

/** Today's date as YYYY-MM-DD (the `captured_for` day for a batch). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ingest a batch of scraped candidates for an already-resolved tenant.
 *
 * Holds the shared normalise/fit/dedupe/insert logic so machine callers that
 * have no auth session (a scheduled Deal Radar run, the token-guarded ingress)
 * can queue candidates by passing the tenantId explicitly, without a session.
 * ingestCandidates() is the auth-resolving wrapper.
 */
export async function ingestCandidatesForTenant(
  tenantId: string,
  candidates: ScrapedCandidate[],
  opts?: IngestOptions
): Promise<IngestSummary> {
  const capturedFor = opts?.capturedFor ?? todayIso();

  const summary: IngestSummary = { inserted: 0, merged: 0, skipped: 0, errors: [] };
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;

  // The network's investor briefs, loaded once for the whole batch. Every
  // candidate is scored against these so each lead lands carrying its best match
  // (BSE-OPP-P01 M1). An empty store means every lead is flagged unmatched.
  const investors = await listActiveInvestorCriteriaForTenant(tenantId);

  // Pending candidates for this tenant, keyed by physical door, WITH their id +
  // stored jsonb so a cross-source duplicate can be MERGED onto the survivor
  // (M2) rather than dropped. The map is updated in-place as the batch inserts,
  // so a duplicate within the same batch merges too.
  const pendingByKey = new Map<string, { id: string; candidate: StoredCandidate }>();
  const existingCandidates = await db
    .select({
      id: leadCandidates.id,
      address: leadCandidates.address,
      postcode: leadCandidates.postcode,
      candidate: leadCandidates.candidate,
    })
    .from(leadCandidates)
    .where(and(eq(leadCandidates.tenantId, tenantId), eq(leadCandidates.status, 'pending')));
  for (const row of existingCandidates) {
    const key = dedupeKey({ address: row.address ?? '', postcode: row.postcode ?? undefined, channel: 'direct' });
    if (key) pendingByKey.set(key, { id: row.id, candidate: row.candidate as StoredCandidate });
  }

  // Doors already promoted to a deal: a duplicate of one of these de-dupes to a
  // no-op (the confirmed pending-only merge boundary - an in-flight deal is not
  // reopened by a fresh sighting of the same door).
  const dealKeys = new Set<string>();
  const existingDeals = await db
    .select({ address: deals.address, postcode: deals.postcode })
    .from(deals)
    .where(eq(deals.tenantId, tenantId));
  for (const row of existingDeals) {
    dealKeys.add(dedupeKey({ address: row.address ?? '', postcode: row.postcode ?? undefined, channel: 'direct' }));
  }

  // In-platform on-market discount scoring (M2, AC-05): built lazily and fail-soft.
  // Only when at least one candidate is an on-market listing arriving WITHOUT a
  // discount signal do we stream the Land Registry comps; if that data is not
  // present (the M3 hosting follow-up), scoring is skipped and ingestion proceeds.
  const threshold = resolveDiscountThreshold(opts);
  const hpiFactor = resolveHpiFactor(opts);
  const scoring = await maybeBuildOnMarketScoring(candidates, hpiFactor);
  // Off-market negotiability fusion (M3, AC-06): built lazily + fail-soft, on the
  // same data gate as the discount scorer. Fuses a propensity score onto on-market
  // listings even at full asking price.
  const propensity = await maybeBuildPropensityScoring(candidates, hpiFactor);

  for (const raw of candidates) {
    try {
      const c = normaliseCandidate(raw);
      const key = dedupeKey(c);

      // A candidate with neither a postcode nor any address text can't be deduped
      // reliably; skip it rather than flooding the queue with collisions. (A
      // no-postcode listing WITH an address now keys off street + town, so it is
      // no longer dropped here - the M0 fix for ~half the portal yield.)
      if (key === '' || key === ':') {
        summary.skipped++;
        continue;
      }

      // Door already a deal: no-op (pending-only merge boundary).
      if (dealKeys.has(key)) {
        summary.skipped++;
        continue;
      }

      // Same door already pending: merge this source onto the survivor (M2). A
      // brand-new source counts as `merged`; an idempotent re-post of a source we
      // already hold is a no-op (`skipped`) so re-running a feeder changes nothing.
      const existing = pendingByKey.get(key);
      if (existing) {
        const { candidate: mergedCandidate, added } = mergeStoredCandidate(existing.candidate, c);
        if (added) {
          await db
            .update(leadCandidates)
            .set({ candidate: mergedCandidate as unknown as Record<string, unknown>, updatedAt: new Date() })
            .where(and(eq(leadCandidates.id, existing.id), eq(leadCandidates.tenantId, tenantId)));
          pendingByKey.set(key, { id: existing.id, candidate: mergedCandidate });
          summary.merged++;
        } else {
          summary.skipped++;
        }
        continue;
      }

      // New door. Score its discount in-platform first (on-market listings that
      // arrived without a discount signal), then match against the investor store.
      let discountEvidence: StoredCandidate['discountEvidence'];
      if (scoring && scoring.needs(c)) {
        const s = scoring.score(c, threshold);
        if (s) {
          c.radar = s.radar;
          discountEvidence = s.discountEvidence;
        }
      }

      // Fuse the off-market negotiability score (M3): fires for every on-market
      // listing including full-asking ones, independent of the discount pass, and
      // is merged onto (never replaces) the radar so the discount headline stays.
      if (propensity && propensity.needs(c)) {
        const p = propensity.score(c);
        if (p) c.radar = { ...c.radar, negotiability: p.negotiability };
      }

      // Score this lead against the whole investor store; the best match rides
      // onto the row (fitPct + client column) and its full summary is stored in
      // the candidate jsonb for the review card and the approved deal.
      const match = summariseMatch(matchCandidateToClients(c, investors));
      const stored: StoredCandidate = {
        ...c,
        match,
        sources: [toLeadSourceMeta(c)],
        ...(discountEvidence ? { discountEvidence } : {}),
      };

      const id = `lc-${ulid()}`;
      await db.insert(leadCandidates).values({
        id,
        tenantId,
        status: 'pending',
        address: c.address || null,
        postcode: c.postcode ?? null,
        source: c.channel,
        fitPct: match.pct,
        client: match.matched ? (match.investorName ?? null) : (c.client ?? null),
        candidate: stored as unknown as Record<string, unknown>,
        capturedFor,
      });

      pendingByKey.set(key, { id, candidate: stored });
      summary.inserted++;
    } catch (e) {
      summary.errors.push({
        address: raw?.address ?? '(unknown)',
        reason: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  if (summary.inserted > 0 || summary.merged > 0) revalidatePath('/review');
  return summary;
}

/**
 * Build the in-platform on-market discount scorer for a batch, or null when it is
 * not needed / not available (M2, AC-05). Returns a small closure over the comp
 * index so the ingest loop stays clean. Fail-soft: if the Land Registry comp data
 * is absent (the ~multi-GB files live on Connor's Mac; the M3 hosting follow-up),
 * we log and return null - every candidate still ingests, just un-enriched.
 */
async function maybeBuildOnMarketScoring(
  candidates: ScrapedCandidate[],
  hpiFactor: number
): Promise<{
  needs: (c: ScrapedCandidate) => boolean;
  score: (c: ScrapedCandidate, threshold?: number) => { radar: ScrapedCandidate['radar']; discountEvidence: StoredCandidate['discountEvidence'] } | null;
} | null> {
  const { needsOnMarketScore, scoreOnMarketCandidate } = await import('@/server/deal-radar/on-market-score');

  const anyNeeds = candidates.some((raw) => {
    const c = normaliseCandidate(raw);
    return needsOnMarketScore(c, leadMarket(c));
  });
  if (!anyNeeds) return null;

  try {
    // M5: the published index artifact in the cloud, or a local streaming build in
    // dev (RDR_DATA_DIR). Throws when neither is available -> caught below, fail-soft.
    const { loadCompIndex } = await import('@/server/deal-radar/patch-index-store');
    const index = await loadCompIndex();
    return {
      needs: (c) => needsOnMarketScore(c, leadMarket(c)),
      score: (c, threshold) =>
        scoreOnMarketCandidate(c, index, { hpiFactor, ...(threshold != null ? { threshold } : {}) }),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[lead-review] on-market comp data unavailable; skipping in-platform discount scoring:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Build the in-platform off-market negotiability scorer for a batch, or null when
 * it is not needed / not available (M3, AC-06). Fuses the Deal Radar historic
 * propensity lens onto on-market listings so a full-asking listing carries a
 * negotiability probability with reasons. Fail-soft on the SAME data gate as the
 * discount scorer: the propensity index streams the ~multi-GB Land Registry + EPC
 * files (Connor's Mac; the cloud-hosting follow-up), so if that data is absent - or
 * any source inside the build throws - we log and return null; every candidate
 * still ingests, just without a negotiability score. Person-level (deceased-estates
 * / PSC) sources stay behind their existing env gates in the index build.
 */
async function maybeBuildPropensityScoring(candidates: ScrapedCandidate[], hpiFactor: number): Promise<{
  needs: (c: ScrapedCandidate) => boolean;
  score: (c: ScrapedCandidate) => { negotiability: NonNullable<ScrapedCandidate['radar']>['negotiability'] } | null;
} | null> {
  const { needsPropensityScore, scoreOffMarketPropensity } = await import('@/server/deal-radar/off-market-score');

  const anyNeeds = candidates.some((raw) => {
    const c = normaliseCandidate(raw);
    return needsPropensityScore(c, leadMarket(c));
  });
  if (!anyNeeds) return null;

  try {
    // M5: the published index artifact in the cloud, or a local streaming build in
    // dev (RDR_DATA_DIR). Throws when neither is available -> caught below, fail-soft.
    const { loadPropensityIndex } = await import('@/server/deal-radar/patch-index-store');
    const index = await loadPropensityIndex();
    return {
      needs: (c) => needsPropensityScore(c, leadMarket(c)),
      score: (c) => scoreOffMarketPropensity(c, index, { hpiFactor }),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[lead-review] off-market propensity data unavailable; skipping negotiability scoring:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
