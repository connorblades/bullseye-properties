import 'server-only';

/**
 * Daily review digest sender (BSE-OPP-P01 M4, AC-07).
 *
 * The server edge that turns a tenant's pending review inbox into an email. The
 * scheduled Trigger task (daily-review-digest) calls sendDailyDigestForTenant for
 * each active tenant. It has no auth session, so it is tenant-scoped by explicit
 * tenantId (mirroring ingestCandidatesForTenant / runDealRadarScore).
 *
 * The ranking + template are pure and unit-tested (lib/lead-rank, lib/lead-digest);
 * this module only does the DB read, recipient resolution, and the Resend send.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { leadCandidates, partnerProfiles, tenants } from '@/server/db/schema';
import { compareByCombinedScore } from '@/lib/lead-rank';
import { buildDigestEmail, toDigestLead, type DigestLead } from '@/lib/lead-digest';
import type { StoredCandidate } from '@/lib/lead-intake';
import { sendEmail } from '@/server/email/resend';

/** How many leads the digest lists by default (env RDR_DIGEST_TOP_N overrides). */
const DEFAULT_TOP_N = 8;

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

function resolveTopN(opt?: number): number {
  if (typeof opt === 'number' && Number.isFinite(opt) && opt > 0) return Math.floor(opt);
  const env = Number(process.env.RDR_DIGEST_TOP_N);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_TOP_N;
}

export interface DigestSendResult {
  tenantId: string;
  /** 'sent' | 'skipped-empty' (no pending leads) | 'skipped-no-recipient'. */
  outcome: 'sent' | 'skipped-empty' | 'skipped-no-recipient';
  totalPending: number;
  included: number;
  recipient?: string;
  emailId?: string;
}

export interface DigestOptions {
  /** Override the number of leads listed (else RDR_DIGEST_TOP_N, else 8). */
  topN?: number;
  /** Override the recipient (else the tenant partner profile contactEmail, else DIGEST_TO). */
  to?: string;
  /** ISO date for the digest (defaults to now). */
  dateIso?: string;
}

/**
 * Build and send the daily review digest for one tenant. Reads the pending
 * candidates, ranks them with the M4 combined score, lists the top-N, and emails
 * the tenant partner. No-ops (no email) when the inbox is empty or no recipient can
 * be resolved. Fail-soft is the caller's job (the task catches per-tenant errors).
 */
export async function sendDailyDigestForTenant(
  tenantId: string,
  opts?: DigestOptions
): Promise<DigestSendResult> {
  const rows = await db
    .select({
      address: leadCandidates.address,
      postcode: leadCandidates.postcode,
      fitPct: leadCandidates.fitPct,
      candidate: leadCandidates.candidate,
    })
    .from(leadCandidates)
    .where(and(eq(leadCandidates.tenantId, tenantId), eq(leadCandidates.status, 'pending')));

  const totalPending = rows.length;
  if (totalPending === 0) {
    return { tenantId, outcome: 'skipped-empty', totalPending: 0, included: 0 };
  }

  const recipient = await resolveRecipient(tenantId, opts?.to);
  if (!recipient) {
    return { tenantId, outcome: 'skipped-no-recipient', totalPending, included: 0 };
  }

  const topN = resolveTopN(opts?.topN);
  const ranked = [...rows].sort((a, b) =>
    compareByCombinedScore(
      { fitPct: a.fitPct, radar: (a.candidate as StoredCandidate).radar },
      { fitPct: b.fitPct, radar: (b.candidate as StoredCandidate).radar }
    )
  );
  const leads: DigestLead[] = ranked.slice(0, topN).map((r) =>
    toDigestLead({
      address: r.address,
      postcode: r.postcode,
      fitPct: r.fitPct,
      candidate: r.candidate as StoredCandidate,
    })
  );

  const partnerName = await resolvePartnerName(tenantId);
  const email = buildDigestEmail({
    partnerName,
    dateIso: opts?.dateIso ?? new Date().toISOString(),
    reviewUrl: `${siteUrl()}/review`,
    leads,
    totalPending,
  });

  const { id } = await sendEmail({ to: recipient, subject: email.subject, html: email.html, text: email.text });
  return { tenantId, outcome: 'sent', totalPending, included: leads.length, recipient, emailId: id };
}

/** Recipient: explicit override, else the tenant partner profile email, else DIGEST_TO env. */
async function resolveRecipient(tenantId: string, override?: string): Promise<string | null> {
  if (override && override.trim()) return override.trim();
  const profile = await db
    .select({ contactEmail: partnerProfiles.contactEmail })
    .from(partnerProfiles)
    .where(eq(partnerProfiles.tenantId, tenantId))
    .limit(1);
  const email = profile[0]?.contactEmail?.trim();
  if (email) return email;
  const fallback = process.env.DIGEST_TO?.trim();
  return fallback || null;
}

/** Partner display name for the greeting, else the tenant name, else a neutral default. */
async function resolvePartnerName(tenantId: string): Promise<string> {
  const profile = await db
    .select({ displayName: partnerProfiles.displayName })
    .from(partnerProfiles)
    .where(eq(partnerProfiles.tenantId, tenantId))
    .limit(1);
  return profile[0]?.displayName?.trim() || 'Partner';
}

/** Every active (non-deleted) tenant id - the default fan-out for the scheduled task. */
export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.status, 'active'), isNull(tenants.deletedAt)));
  return rows.map((r) => r.id);
}
