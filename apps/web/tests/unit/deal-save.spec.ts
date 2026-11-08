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
import { deals } from '@/server/db/schema';
import { updateDealById } from '@/server/actions/deals';
import { emptyDeal } from '@/lib/deal-factory';

beforeAll(async () => {
  await db.execute(sql`create table deals (
    id text primary key, tenant_id text not null, address text, postcode text,
    source text, current_stage integer, delivered boolean,
    inputs jsonb not null default '{}', updated_at timestamptz, deleted_at timestamptz
  )`);
});
beforeEach(async () => {
  await db.execute(sql`truncate deals`);
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
