import 'server-only';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals, dealReportVersions } from '@/server/db/schema';
import type { DealReportVersion } from '@/server/db/schema';
import { assembleDeal } from './assemble';
import { loadPartnerIdentity } from './partner';
import type { Deal } from '@/lib/deal-store';
import type { PartnerIdentity } from '@/server/pdf/components';

/**
 * Public, unauthenticated deal load for the shareable Outline pack (/o/[id]).
 *
 * Uses the direct (owner) connection by deal id only - no tenant/session check -
 * so a prospect can open the outline link without an account. The deal id is an
 * unguessable ULID, and only outline-safe fields are ever rendered. (Proper
 * tokenised, revocable share links land in M4.)
 */
export async function loadDealPublic(
  id: string,
): Promise<{ deal: Deal; partner: PartnerIdentity; reference: string } | null> {
  const rows = await db.select().from(deals).where(and(eq(deals.id, id), isNull(deals.deletedAt))).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    deal: assembleDeal(row),
    partner: await loadPartnerIdentity(row.tenantId),
    reference: row.reference,
  };
}

/**
 * Public, unauthenticated load of a rendered deal-report version for the
 * token-gated investor view (/r/[token], M4-T3). Owner connection, no session -
 * access is already gated by the share token. Returns the pinned version when
 * versionId is given, else the latest successfully rendered version with a
 * stored PDF. Returns null when nothing has been rendered.
 */
export async function loadReportVersionPublic(
  dealId: string,
  versionId?: string,
): Promise<DealReportVersion | null> {
  const where = versionId
    ? and(
        eq(dealReportVersions.id, versionId),
        eq(dealReportVersions.dealId, dealId),
        eq(dealReportVersions.status, 'rendered'),
        isNotNull(dealReportVersions.pdfStoragePath),
      )
    : and(
        eq(dealReportVersions.dealId, dealId),
        eq(dealReportVersions.status, 'rendered'),
        isNotNull(dealReportVersions.pdfStoragePath),
      );

  const rows = await db
    .select()
    .from(dealReportVersions)
    .where(where)
    .orderBy(desc(dealReportVersions.version))
    .limit(1);
  return rows[0] ?? null;
}
