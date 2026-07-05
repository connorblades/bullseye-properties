'use server';

/**
 * Lead review (M5, Stage 3): the staging layer between a scraped candidate and a
 * deal on the pipeline board.
 *
 * ingestCandidates() takes a batch of ScrapedCandidates, normalises each, scores
 * fit against the (candidate-carried) investor criteria, dedupes against both
 * already-pending lead_candidates and existing deals for the tenant, and inserts
 * the survivors as `pending` rows. A partner then reviews the queue
 * (listPendingCandidates) and either approveCandidate() - which promotes it to a
 * real deal at pipelineStage 'leads' - or discardCandidate().
 *
 * Everything is tenant-scoped through requireTenant(), mirroring deals.ts. The
 * ingest loop is fail-soft: one bad candidate is recorded as an error and the
 * rest still land.
 */

import { revalidatePath } from 'next/cache';
import { ulid } from 'ulid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals, leadCandidates } from '@/server/db/schema';
import { requireTenant, createDeal } from '@/server/actions/deals';
import {
  normaliseCandidate,
  candidateToDealInput,
  dedupeKey,
  fitForCandidate,
  type ScrapedCandidate,
} from '@/lib/lead-intake';

export type IngestSummary = {
  inserted: number;
  skipped: number;
  errors: { address: string; reason: string }[];
};

export type IngestOptions = {
  /** Override the capture date (defaults to today, YYYY-MM-DD). */
  capturedFor?: string;
};

/** Today's date as YYYY-MM-DD (the `captured_for` day for a batch). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ingest a batch of scraped candidates as pending lead_candidates.
 *
 * Per candidate: normalise, compute fit, and dedupe by dedupeKey against both
 * the pending candidates already in the queue and the tenant's existing deals.
 * Survivors are inserted as `pending`. Fail-soft: a throwing candidate is
 * recorded in `errors` and does not abort the batch.
 *
 * Auth-resolving wrapper around ingestCandidatesForTenant, mirroring the
 * createDeal -> createDealForTenant pattern in deals.ts.
 */
export async function ingestCandidates(
  candidates: ScrapedCandidate[],
  opts?: IngestOptions
): Promise<IngestSummary> {
  const { tenantId } = await requireTenant();
  return ingestCandidatesForTenant(tenantId, candidates, opts);
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

  const summary: IngestSummary = { inserted: 0, skipped: 0, errors: [] };
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;

  // Existing dedupe keys: pending candidates + existing deals for this tenant.
  const seen = new Set<string>();

  const existingCandidates = await db
    .select({ address: leadCandidates.address, postcode: leadCandidates.postcode })
    .from(leadCandidates)
    .where(and(eq(leadCandidates.tenantId, tenantId), eq(leadCandidates.status, 'pending')));
  for (const row of existingCandidates) {
    seen.add(dedupeKey({ address: row.address ?? '', postcode: row.postcode ?? undefined, channel: 'direct' }));
  }

  const existingDeals = await db
    .select({ address: deals.address, postcode: deals.postcode })
    .from(deals)
    .where(eq(deals.tenantId, tenantId));
  for (const row of existingDeals) {
    seen.add(dedupeKey({ address: row.address ?? '', postcode: row.postcode ?? undefined, channel: 'direct' }));
  }

  for (const raw of candidates) {
    try {
      const c = normaliseCandidate(raw);
      const key = dedupeKey(c);

      // A meaningless key (no postcode and no house number) can't be deduped
      // reliably; skip it rather than flooding the queue with collisions.
      if (key === ':' || key === '') {
        summary.skipped++;
        continue;
      }

      if (seen.has(key)) {
        summary.skipped++;
        continue;
      }

      const fitPct = fitForCandidate(c);

      await db.insert(leadCandidates).values({
        id: `lc-${ulid()}`,
        tenantId,
        status: 'pending',
        address: c.address || null,
        postcode: c.postcode ?? null,
        source: c.channel,
        fitPct,
        client: c.client ?? null,
        candidate: c as unknown as Record<string, unknown>,
        capturedFor,
      });

      seen.add(key);
      summary.inserted++;
    } catch (e) {
      summary.errors.push({
        address: raw?.address ?? '(unknown)',
        reason: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  if (summary.inserted > 0) revalidatePath('/leads');
  return summary;
}

/**
 * List the tenant's pending lead candidates, best-fit first. Ties break on the
 * radar discount confidence (higher = a stronger below-market signal) so the
 * most promising leads float to the top of the review queue.
 */
export async function listPendingCandidates() {
  const { tenantId } = await requireTenant();
  const rows = await db
    .select()
    .from(leadCandidates)
    .where(and(eq(leadCandidates.tenantId, tenantId), eq(leadCandidates.status, 'pending')))
    .orderBy(desc(leadCandidates.fitPct), desc(leadCandidates.createdAt));

  // fitPct is the primary sort in SQL; discountConfidence is a nested jsonb
  // value so break ties on it here (SQL can't index into candidate.radar).
  return rows.sort((a, b) => {
    const fitA = a.fitPct ?? 0;
    const fitB = b.fitPct ?? 0;
    if (fitB !== fitA) return fitB - fitA;
    return confidenceOf(b) - confidenceOf(a);
  });
}

/** Pull radar.discountConfidence out of a stored candidate row (0 when absent). */
function confidenceOf(row: { candidate: unknown }): number {
  const cand = row.candidate as ScrapedCandidate | undefined;
  const conf = cand?.radar?.discountConfidence;
  return typeof conf === 'number' && Number.isFinite(conf) ? conf : 0;
}

/**
 * Approve a pending candidate: create the deal (lands at pipelineStage 'leads'),
 * then mark the candidate row approved with its new dealId. Returns the deal id.
 */
export async function approveCandidate(id: string): Promise<string> {
  const { userId, tenantId } = await requireTenant();

  const rows = await db
    .select()
    .from(leadCandidates)
    .where(and(eq(leadCandidates.id, id), eq(leadCandidates.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('Lead candidate not found.');
  if (row.status !== 'pending') throw new Error(`Lead candidate is already ${row.status}.`);

  const candidate = row.candidate as ScrapedCandidate;
  const { id: dealId } = await createDeal(candidateToDealInput(candidate));

  await db
    .update(leadCandidates)
    .set({
      status: 'approved',
      dealId,
      reviewedAt: new Date(),
      reviewedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(leadCandidates.id, id), eq(leadCandidates.tenantId, tenantId)));

  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return dealId;
}

/** Discard a pending candidate: mark it discarded and stamp the review time. */
export async function discardCandidate(id: string): Promise<void> {
  const { userId, tenantId } = await requireTenant();

  await db
    .update(leadCandidates)
    .set({
      status: 'discarded',
      reviewedAt: new Date(),
      reviewedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(leadCandidates.id, id), eq(leadCandidates.tenantId, tenantId)));

  revalidatePath('/leads');
}
