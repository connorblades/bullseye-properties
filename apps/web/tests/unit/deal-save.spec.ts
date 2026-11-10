import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const lifecycle = vi.hoisted(() => ({ close: async () => {} }));
vi.mock('@/server/db/client', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  lifecycle.close = () => client.close();
  return { db: drizzle(client) };
});
vi.mock('@/server/auth/tenant', () => ({ requireTenant: async () => ({ tenantId: 'a', userId: 'user-a' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { db } from '@/server/db/client';
import { deals, investorCriteria } from '@/server/db/schema';
import { updateDealById, createDeal } from '@/server/actions/deals';
import { emptyDeal } from '@/lib/deal-factory';

beforeAll(async () => {
  await db.execute(sql`create table deals (
    id text primary key, tenant_id text not null, reference text, address text, postcode text,
    source text, current_stage integer, delivered boolean,
    inputs jsonb not null default '{}', investor_id text, status text default 'active', created_at timestamptz default now(), updated_at timestamptz, deleted_at timestamptz
  )`);
  await db.execute(sql`create table investor_criteria (
    id text primary key, tenant_id text not null, name text not null,
    budget text, areas text, property_type text, target_yield text, strategy text, notes text,
    active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
  )`);
});
beforeEach(async () => {
  await db.execute(sql`truncate deals, investor_criteria`);
  await db.insert(investorCriteria).values([
    { id: 'brief-a', tenantId: 'a', name: 'Example Client', budget: '250000', areas: 'Example area', propertyType: 'Terraced', targetYield: '7%' },
    { id: 'brief-b', tenantId: 'b', name: 'Other tenant' },
    { id: 'brief-paused', tenantId: 'a', name: 'Paused brief', active: false },
    { id: 'brief-deleted', tenantId: 'a', name: 'Deleted brief', deletedAt: new Date() },
  ]);
  await db.execute(sql`insert into deals(id, tenant_id, inputs, deleted_at) values
    ('own', 'a', '{"untouched":"keep"}', null),
    ('other', 'b', '{"untouched":"keep"}', null),
    ('deleted', 'a', '{"untouched":"keep"}', now())`);
});
afterAll(() => lifecycle.close());

describe('database save acknowledgement', () => {
  it.each(['other', 'deleted', 'missing'])('does not acknowledge a save to %s', async (id) => {
    await expect(updateDealById(id, { address: 'Example Property' })).rejects.toThrow('no longer available');
    const rows = await db.select({ address: deals.address }).from(deals).where(eq(deals.id, id));
    if (rows.length) expect(rows[0].address).toBeNull();
  });

  it('keeps independent sections when requests arrive together', async () => {
    const draft = emptyDeal('own');
    draft.viewing.notes = 'Example observation';
    await Promise.all([
      updateDealById('own', { viewing: draft.viewing }),
      updateDealById('own', { criteria: draft.criteria }),
    ]);
    const [row] = await db.select({ inputs: deals.inputs }).from(deals).where(eq(deals.id, 'own'));
    expect(row.inputs).toEqual({ untouched: 'keep', viewing: draft.viewing, criteria: draft.criteria });
  });

  it('saves progress with evidence and ignores attempts to replace the identifier', async () => {
    await updateDealById('own', { id: 'replacement', address: 'Example Property', progress: 9 });
    const [row] = await db.select({ id: deals.id, address: deals.address, progress: deals.currentStage, inputs: deals.inputs }).from(deals).where(eq(deals.id, 'own'));
    expect(row).toEqual({ id: 'own', address: 'Example Property', progress: 9, inputs: { untouched: 'keep' } });
  });
});


describe('new deal client selection', () => {
  const input = { address: 'Example Property, SW1A 1AA', source: 'estate-agent' as const };
  it('copies the selected active brief from the database, ignoring a forged name or budget', async () => {
    const draft = emptyDeal('test');
    const { id } = await createDeal({ ...input, clientBriefId: 'brief-a', initialInputs: { client: 'Wrong client', criteria: draft.criteria } });
    const [row] = await db.select({ inputs: deals.inputs, tenantId: deals.tenantId }).from(deals).where(eq(deals.id, id));
    expect(row.tenantId).toBe('a');
    expect(row.inputs).toMatchObject({ client: 'Example Client', clientBrief: { id: 'brief-a', name: 'Example Client' },
      criteria: { budget: '250000', areas: 'Example area', propertyType: 'Terraced', targetYield: '7%', timeline: '' } });
  });
  it.each(['brief-b', 'brief-paused', 'brief-deleted', 'missing'])('rejects unavailable selection %s without creating a deal', async (clientBriefId) => {
    await expect(createDeal({ ...input, clientBriefId })).rejects.toThrow('no longer available');
    expect(await db.select({ id: deals.id }).from(deals)).toHaveLength(3);
  });
  it('supports an unassigned deal without copying a sample client', async () => {
    const { id } = await createDeal({ ...input, clientBriefId: '', initialInputs: { client: 'Stale selection' } });
    const [row] = await db.select({ inputs: deals.inputs }).from(deals).where(eq(deals.id, id));
    expect(row.inputs).toMatchObject({ client: '' });
    expect(row.inputs).not.toHaveProperty('clientBrief');
  });
  it('preserves existing lead-intake client data when no picker selection is supplied', async () => {
    const { id } = await createDeal({ ...input, initialInputs: { client: 'Matched client' } });
    const [row] = await db.select({ inputs: deals.inputs }).from(deals).where(eq(deals.id, id));
    expect(row.inputs).toMatchObject({ client: 'Matched client' });
  });
});
