import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals } from '@/server/db/schema';
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
