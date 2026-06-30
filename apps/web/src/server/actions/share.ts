'use server';

/**
 * Share-link management Server Actions (M4-T2).
 *
 * Partner-facing CRUD over share tokens, all tenant-scoped via requireTenant +
 * a tenant-checked deal load. The raw secret is only ever returned by
 * createDealShareLink (shown once in the UI); list/revoke operate on metadata.
 */

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { dealReportVersions } from '@/server/db/schema';
import { requireTenant } from '@/server/auth/tenant';
import { loadDeal } from '@/server/actions/deals';
import { buildShareUrl } from '@/lib/share-url';
import {
  createShareToken,
  listShareTokensForDeal,
  revokeShareToken,
  shareTokenStatus,
  type ShareTokenKind,
  type ShareTokenStatus,
} from '@/server/share/tokens';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

/** Latest successfully-rendered report version for a deal, or null. Tenant-scoped. */
async function latestRenderedReport(
  tenantId: string,
  dealId: string,
): Promise<{ id: string; version: number } | null> {
  const rows = await db
    .select({ id: dealReportVersions.id, version: dealReportVersions.version })
    .from(dealReportVersions)
    .where(
      and(
        eq(dealReportVersions.tenantId, tenantId),
        eq(dealReportVersions.dealId, dealId),
        eq(dealReportVersions.status, 'rendered'),
        isNotNull(dealReportVersions.pdfStoragePath),
      ),
    )
    .orderBy(desc(dealReportVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Whether a deal has a rendered report yet - used by the share page to gate
 * report-link creation. Tenant-scoped.
 */
export async function dealHasRenderedReport(dealId: string): Promise<boolean> {
  const { tenantId } = await requireTenant();
  return (await latestRenderedReport(tenantId, dealId)) !== null;
}

export interface ShareLinkView {
  id: string;
  kind: ShareTokenKind;
  status: ShareTokenStatus;
  label: string | null;
  recipientEmail: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateShareLinkInput {
  dealId: string;
  kind: ShareTokenKind;
  label?: string | null;
  recipientEmail?: string | null;
  reportVersionId?: string | null;
  /** undefined = 90-day default; 0 or negative = never expires; else N days. */
  expiresInDays?: number | null;
}

/** Mint a share link. Returns the one-time URL (with the raw secret) + metadata. */
export async function createDealShareLink(
  input: CreateShareLinkInput,
): Promise<{ id: string; url: string; expiresAt: string | null }> {
  const { tenantId, userId } = await requireTenant();
  const deal = await loadDeal(input.dealId); // tenant-scoped; null if not theirs
  if (!deal) throw new Error('Deal not found');

  // Report links pin a specific rendered version, so the investor always sees
  // exactly what was current when the link was created. Default to the latest
  // rendered version when the caller did not pin one.
  let reportVersionId = input.reportVersionId ?? null;
  if (input.kind === 'report' && !reportVersionId) {
    const latest = await latestRenderedReport(tenantId, input.dealId);
    if (!latest) throw new Error('No rendered report yet. Generate one in Stage 14 first.');
    reportVersionId = latest.id;
  }

  let expiresAt: Date | null | undefined;
  if (input.expiresInDays === undefined) {
    expiresAt = undefined; // store default 90 days
  } else if (input.expiresInDays === null || input.expiresInDays <= 0) {
    expiresAt = null; // never expires
  } else {
    expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  }

  const { token, secret } = await createShareToken({
    tenantId,
    dealId: input.dealId,
    kind: input.kind,
    createdBy: userId,
    label: input.label ?? null,
    recipientEmail: input.recipientEmail ?? null,
    reportVersionId,
    expiresAt,
  });

  revalidatePath(`/deal/${input.dealId}/share`);
  return {
    id: token.id,
    url: buildShareUrl(input.kind, secret, siteUrl()),
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
  };
}

/** List a deal's share links (newest first), optionally filtered by kind. */
export async function listDealShareLinks(
  dealId: string,
  kind?: ShareTokenKind,
): Promise<ShareLinkView[]> {
  const { tenantId } = await requireTenant();
  const deal = await loadDeal(dealId);
  if (!deal) throw new Error('Deal not found');

  const now = new Date();
  const rows = await listShareTokensForDeal(tenantId, dealId);
  return rows
    .filter((r) => !kind || r.kind === kind)
    .map((r) => ({
      id: r.id,
      kind: r.kind as ShareTokenKind,
      status: shareTokenStatus(r, now),
      label: r.label,
      recipientEmail: r.recipientEmail,
      accessCount: r.accessCount,
      lastAccessedAt: r.lastAccessedAt ? r.lastAccessedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    }));
}

/** Revoke a share link. Tenant-scoped; returns true if newly revoked. */
export async function revokeDealShareLink(tokenId: string, dealId: string): Promise<boolean> {
  const { tenantId } = await requireTenant();
  const deal = await loadDeal(dealId);
  if (!deal) throw new Error('Deal not found');
  const revoked = await revokeShareToken(tokenId, tenantId);
  revalidatePath(`/deal/${dealId}/share`);
  return revoked;
}
