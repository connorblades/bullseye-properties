'use server';

/**
 * Investor criteria: server-side CRUD for the network criteria store
 * (BSE-OPP-P01 M1). Every action is tenant-scoped through requireTenant(),
 * mirroring deals.ts and lead-review.ts, so an investor brief is isolated to the
 * partner's tenant from day one (RLS mirrors deals; see migration 0010).
 *
 * The store is the moonshot's compounding asset: adding an investor here
 * immediately improves match coverage for every future lead.
 */

import { revalidatePath } from 'next/cache';
import { ulid } from 'ulid';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { investorCriteria } from '@/server/db/schema';
import { requireTenant } from '@/server/actions/deals';
import type { ParsedInvestor } from '@/lib/investor-csv';

/** The editable fields of an investor brief (everything but the identifiers). */
export type InvestorCriteriaInput = {
  name: string;
  budget?: string;
  areas?: string;
  propertyType?: string;
  targetYield?: string;
  strategy?: string;
  notes?: string;
  active?: boolean;
};

/** Trim to null-if-empty for a nullable text column. */
function orNull(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * List all of the current tenant's investor briefs (active and paused, newest
 * name order), for the /clients management surface. Excludes soft-deleted rows.
 */
export async function listInvestorCriteria() {
  const { tenantId } = await requireTenant();
  return db
    .select()
    .from(investorCriteria)
    .where(and(eq(investorCriteria.tenantId, tenantId), isNull(investorCriteria.deletedAt)))
    .orderBy(asc(investorCriteria.name));
}

/** Create one investor brief for the current tenant. Returns its new id. */
export async function createInvestorCriteria(input: InvestorCriteriaInput): Promise<string> {
  const { tenantId } = await requireTenant();
  const name = input.name?.trim();
  if (!name) throw new Error('An investor name is required.');

  const id = `ic-${ulid()}`;
  await db.insert(investorCriteria).values({
    id,
    tenantId,
    name,
    budget: orNull(input.budget),
    areas: orNull(input.areas),
    propertyType: orNull(input.propertyType),
    targetYield: orNull(input.targetYield),
    strategy: orNull(input.strategy),
    notes: orNull(input.notes),
    active: input.active ?? true,
  });

  revalidatePath('/clients');
  return id;
}

/**
 * Bulk-insert a set of parsed investor rows (CSV/paste). Fail-soft per row: a
 * row that throws is recorded and the rest still land. Returns a summary the
 * upload UI can show. Names are not deduped - a partner may legitimately hold
 * two briefs for the same investor; editing/removing is manual.
 */
export async function bulkCreateInvestorCriteria(
  rows: ParsedInvestor[]
): Promise<{ inserted: number; errors: { name: string; reason: string }[] }> {
  const { tenantId } = await requireTenant();
  const summary = { inserted: 0, errors: [] as { name: string; reason: string }[] };
  if (!Array.isArray(rows) || rows.length === 0) return summary;

  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) {
      summary.errors.push({ name: '(unnamed)', reason: 'Missing investor name.' });
      continue;
    }
    try {
      await db.insert(investorCriteria).values({
        id: `ic-${ulid()}`,
        tenantId,
        name,
        budget: orNull(row.budget),
        areas: orNull(row.areas),
        propertyType: orNull(row.propertyType),
        targetYield: orNull(row.targetYield),
        strategy: orNull(row.strategy),
        notes: orNull(row.notes),
        active: true,
      });
      summary.inserted++;
    } catch (e) {
      summary.errors.push({ name, reason: e instanceof Error ? e.message : 'Insert failed.' });
    }
  }

  if (summary.inserted > 0) revalidatePath('/clients');
  return summary;
}

/** Patch one investor brief. Only provided fields change. */
export async function updateInvestorCriteria(
  id: string,
  patch: Partial<InvestorCriteriaInput>
): Promise<void> {
  const { tenantId } = await requireTenant();

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('An investor name is required.');
    set.name = name;
  }
  if (patch.budget !== undefined) set.budget = orNull(patch.budget);
  if (patch.areas !== undefined) set.areas = orNull(patch.areas);
  if (patch.propertyType !== undefined) set.propertyType = orNull(patch.propertyType);
  if (patch.targetYield !== undefined) set.targetYield = orNull(patch.targetYield);
  if (patch.strategy !== undefined) set.strategy = orNull(patch.strategy);
  if (patch.notes !== undefined) set.notes = orNull(patch.notes);
  if (patch.active !== undefined) set.active = patch.active;

  await db
    .update(investorCriteria)
    .set(set)
    .where(and(eq(investorCriteria.id, id), eq(investorCriteria.tenantId, tenantId)));

  revalidatePath('/clients');
}

/** Soft-delete one investor brief (excludes it from matching and the list). */
export async function deleteInvestorCriteria(id: string): Promise<void> {
  const { tenantId } = await requireTenant();
  await db
    .update(investorCriteria)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(investorCriteria.id, id), eq(investorCriteria.tenantId, tenantId)));
  revalidatePath('/clients');
}
