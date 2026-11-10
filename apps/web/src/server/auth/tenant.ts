import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { memberships } from '@/server/db/schema';
import { getUser } from './server';

/**
 * Resolve the current user's tenant from their membership.
 *
 * The direct database connection does not carry the user's session. All
 * authenticated callers must use this guard and scope queries to its tenant.
 */
export async function requireTenant(): Promise<{ userId: string; tenantId: string }> {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const rows = await db
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      isNull(memberships.deletedAt),
      ne(memberships.role, 'suspended'),
    ))
    .limit(1);

  if (rows.length === 0) throw new Error('No tenant membership for this user');
  return { userId: user.id, tenantId: rows[0].tenantId };
}
