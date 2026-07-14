/**
 * Investor-criteria store reads (BSE-OPP-P01 M1).
 *
 * Server-only, and deliberately NOT a 'use server' module: this helper takes a
 * caller-supplied tenantId and queries via the owner DB connection (which
 * bypasses RLS), so it must never be reachable as a client-callable server
 * action - that would be a cross-tenant read primitive (AC-03 requires
 * cross-tenant reads to be blocked). It is imported only by server code that has
 * already resolved the tenant (the ingestion matching pass) or by a
 * requireTenant-guarded action.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { investorCriteria } from '@/server/db/schema';
import type { InvestorCriteria } from '@/lib/investor-match';

/**
 * The tenant's active investor briefs, in the matcher's input shape. Active-only
 * so a paused investor is excluded from matching without deleting the row. The
 * caller MUST have authorised access to this tenant already (server-resolved) -
 * this function does not authenticate.
 */
export async function listActiveInvestorCriteriaForTenant(
  tenantId: string
): Promise<InvestorCriteria[]> {
  const rows = await db
    .select()
    .from(investorCriteria)
    .where(
      and(
        eq(investorCriteria.tenantId, tenantId),
        eq(investorCriteria.active, true),
        isNull(investorCriteria.deletedAt)
      )
    )
    .orderBy(asc(investorCriteria.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    budget: r.budget,
    areas: r.areas,
    propertyType: r.propertyType,
    targetYield: r.targetYield,
    strategy: r.strategy,
    notes: r.notes,
  }));
}
