'use server';

/**
 * Authenticated deal actions. Every database operation is scoped using the
 * current user's active membership. The direct database connection does not
 * forward the user's Supabase session, so these checks are required here.
 */

import { revalidatePath } from 'next/cache';
import { ulid } from 'ulid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals } from '@/server/db/schema';
import { requireTenant } from '@/server/auth/tenant';
import { extractPostcode } from '@/server/public-data/geocode';
import type { Deal } from '@/lib/deal-store';

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

export type CreateDealInput = {
  address: string;
  source: Deal['source'];
  initialInputs?: Partial<Deal>;
};

/**
 * Insert a deal for an already-resolved tenant. Holds the shared insert/reference
 * logic so callers that have already resolved a tenant (e.g. batch lead intake in
 * lead-review.ts) can reuse it without re-running requireTenant() per row.
 * createDeal() is the auth-resolving wrapper around this.
 */
async function createDealForTenant(tenantId: string, input: CreateDealInput) {
  // Address is mandatory and must carry a valid UK postcode - every downstream
  // public-data and title pull keys off it.
  const postcode = extractPostcode(input.address);
  if (!postcode) {
    throw new Error('A full property address including a valid UK postcode is required.');
  }

  const existingCount = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.tenantId, tenantId));

  const id = `d-${ulid()}`;
  const reference = buildReference(existingCount.length + 1);

  const { jsonbInputs } = splitDealForStorage(input.initialInputs ?? {});

  await db.insert(deals).values({
    id,
    tenantId,
    reference,
    address: input.address,
    postcode,
    source: input.source,
    currentStage: 2,
    inputs: jsonbInputs,
  });

  revalidatePath('/dashboard');
  return { id, reference };
}

export async function createDeal(input: CreateDealInput) {
  const { tenantId } = await requireTenant();
  return createDealForTenant(tenantId, input);
}

/**
 * Split a Deal patch into Postgres columns vs `inputs` jsonb.
 * The wizard sends partial Deal objects with mixed top-level metadata and
 * nested wizard data; this function routes each to the right destination.
 */
function splitDealForStorage(patch: Partial<Deal>): {
  columns: Partial<{
    address: string;
    postcode: string;
    source: Deal['source'];
    currentStage: number;
    delivered: boolean;
  }>;
  jsonbInputs: Record<string, unknown>;
} {
  const columns: ReturnType<typeof splitDealForStorage>['columns'] = {};
  const jsonbInputs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'id' || key === 'createdAt') continue; // immutable identifiers
    if (key === 'address') columns.address = value as string;
    else if (key === 'postcode') columns.postcode = value as string;
    else if (key === 'source') columns.source = value as Deal['source'];
    else if (key === 'progress') columns.currentStage = value as number;
    else if (key === 'delivered') columns.delivered = value as boolean;
    else jsonbInputs[key] = value;
  }

  return { columns, jsonbInputs };
}

/**
 * Patch a deal. Accepts a partial Deal — top-level fields update their
 * Postgres columns, anything else merges into the `inputs` jsonb.
 *
 * Wizard auto-save calls this on every (debounced) input change, sending
 * the full current Deal object. The merge means partial updates from
 * concurrent clients don't clobber each other's nested fields.
 */
export async function updateDealById(dealId: string, patch: Partial<Deal>) {
  const { tenantId } = await requireTenant();
  const { columns, jsonbInputs } = splitDealForStorage(patch);

  const updateData: Record<string, unknown> = {
    ...columns,
    updatedAt: new Date(),
  };

  // Only merge inputs if there's at least one nested field to update.
  if (Object.keys(jsonbInputs).length > 0) {
    const existing = await db
      .select({ inputs: deals.inputs })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)))
      .limit(1);
    const existingInputs = (existing[0]?.inputs as Record<string, unknown> | undefined) ?? {};
    updateData.inputs = { ...existingInputs, ...jsonbInputs };
  }

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
