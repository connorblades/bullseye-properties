import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { memberships } from '@/server/db/schema';
import { getUser } from './server';

/**
 * Resolve the current user's tenant from their membership.
 *
 * Shared helper (deals.ts has its own private copy from M1; new code should
 * use this one). RLS still enforces tenant isolation in Postgres - this just
 * gives the app layer the tenant id it needs for writes like the cost ledger.
 */
export async function requireTenant(): Promise<{ userId: string; tenantId: string }> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const rows = await db
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
    .limit(1);

  if (rows.length === 0) throw new Error('No tenant membership for this user');
  return { userId: user.id, tenantId: rows[0].tenantId };
}
