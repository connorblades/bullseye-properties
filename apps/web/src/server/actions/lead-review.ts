'use server';

/** Authenticated lead review actions. Resolve the tenant before any data access. */
import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { leadCandidates } from '@/server/db/schema';
import { requireTenant } from '@/server/auth/tenant';
import { createDeal } from '@/server/actions/deals';
import { ingestCandidatesForTenant, type IngestOptions, type IngestSummary } from '@/server/leads/ingest';
import {
  candidateToDealInput, type ScrapedCandidate, type StoredCandidate, type LeadMatchSummary,
} from '@/lib/lead-intake';
import { compareByCombinedScore } from '@/lib/lead-rank';

export type { IngestOptions, IngestSummary } from '@/server/leads/ingest';

export async function ingestCandidates(
  candidates: ScrapedCandidate[],
  opts?: IngestOptions
): Promise<IngestSummary> {
  const { tenantId } = await requireTenant();
  return ingestCandidatesForTenant(tenantId, candidates, opts);
}

/**
 * List the tenant's pending lead candidates, ordered by the M4 combined rank
 * (discount x negotiability x client-fit, fail-soft) so the strongest, best-matched
 * opportunities float to the top of the review queue (AC-07).
 *
 * SQL fetches the rows with fitPct/createdAt as a stable coarse pre-order (SQL can't
 * index into the nested `candidate.radar` jsonb), then the combined score - which
 * folds fitPct with the jsonb discount + negotiability signals - is applied in JS.
 */
export async function listPendingCandidates() {
  const { tenantId } = await requireTenant();
  const rows = await db
    .select()
    .from(leadCandidates)
    .where(and(eq(leadCandidates.tenantId, tenantId), eq(leadCandidates.status, 'pending')))
    .orderBy(desc(leadCandidates.fitPct), desc(leadCandidates.createdAt));

  return rows.sort((a, b) =>
    compareByCombinedScore(
      { fitPct: a.fitPct, radar: (a.candidate as ScrapedCandidate | undefined)?.radar },
      { fitPct: b.fitPct, radar: (b.candidate as ScrapedCandidate | undefined)?.radar }
    )
  );
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

  const candidate = row.candidate as StoredCandidate;
  const match: LeadMatchSummary | undefined = candidate.match;
  const { id: dealId } = await createDeal(candidateToDealInput(candidate, match));

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

  revalidatePath('/review');
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

  revalidatePath('/review');
}
