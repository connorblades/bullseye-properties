'use server';

/**
 * Deals: server-side CRUD for the wizard.
 *
 * These actions are the M1 close target — once the wizard pages call these
 * instead of localStorage (see src/lib/deal-store.ts), M1 is closed and
 * deals persist across devices and sessions.
 *
 * Migration plan (queued as a focused 1-2h session):
 *   1. Replace useDeal hook in deal-store.ts to call loadDeal()/saveDealInputs() here
 *   2. Replace listDeals() to call listDealsForTenant()
 *   3. Replace newId()/saveDeal()/emptyDeal() in /deal/new to call createDeal()
 *   4. Replace seedDemoDealsIfEmpty() with a server-side seed via /admin/seed
 *   5. Add debounced auto-save (800ms) in the wizard to avoid hammering
 *
 * RLS is enforced server-side via the auth.uid() → memberships → tenant_id
 * chain. The action client is created with the user's session cookie so
 * Postgres sees them as `authenticated` and the policies apply.
 */

import { revalidatePath } from 'next/cache';
import { ulid } from 'ulid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals, memberships } from '@/server/db/schema';
import { getUser } from '@/server/auth/server';
import type { Deal } from '@/lib/deal-store';

async function requireTenant(): Promise<{ userId: string; tenantId: string }> {
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

/**
 * Build the partner-scoped reference: BSE-{partner-initials}-{member-3digit}-{deal-3digit}
 * For M1 this is hardcoded to BSE-CB-001-XXX where XXX is the deal sequence.
 * In M3+ partner initials and member number come from partner_profiles.
 */
function buildReference(sequenceNum: number): string {
  const seq = String(sequenceNum).padStart(3, '0');
  return `BSE-CB-001-${seq}`;
}

export async function listDealsForTenant() {
  const { tenantId } = await requireTenant();
  const rows = await db
    .select()
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), isNull(deals.deletedAt)))
    .orderBy(desc(deals.createdAt));
  return rows;
}

export async function loadDeal(dealId: string) {
  const { tenantId } = await requireTenant();
  const rows = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId), isNull(deals.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

type CreateDealInput = {
  address: string;
  source: Deal['source'];
  inputs?: Record<string, unknown>;
};

export async function createDeal(input: CreateDealInput) {
  const { tenantId } = await requireTenant();

  const existingCount = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.tenantId, tenantId));

  const id = `d-${ulid()}`;
  const reference = buildReference(existingCount.length + 1);

  await db.insert(deals).values({
    id,
    tenantId,
    reference,
    address: input.address,
    source: input.source,
    currentStage: 2,
    inputs: input.inputs ?? {},
  });

  revalidatePath('/dashboard');
  return { id, reference };
}

export async function saveDealInputs(dealId: string, inputs: Record<string, unknown>, currentStage?: number) {
  const { tenantId } = await requireTenant();

  const updateData: { inputs: Record<string, unknown>; updatedAt: Date; currentStage?: number } = {
    inputs,
    updatedAt: new Date(),
  };
  if (typeof currentStage === 'number') updateData.currentStage = currentStage;

  await db
    .update(deals)
    .set(updateData)
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)));

  revalidatePath(`/deal/${dealId}/wizard`);
}

export async function markDelivered(dealId: string) {
  const { tenantId } = await requireTenant();
  await db
    .update(deals)
    .set({ delivered: true, updatedAt: new Date() })
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)));
  revalidatePath('/dashboard');
  revalidatePath(`/deal/${dealId}`);
}

export async function softDeleteDeal(dealId: string) {
  const { tenantId } = await requireTenant();
  await db
    .update(deals)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)));
  revalidatePath('/dashboard');
}
