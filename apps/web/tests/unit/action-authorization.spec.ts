import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const fakes = vi.hoisted(() => ({
  getUser: vi.fn(), select: vi.fn(), where: vi.fn(), limit: vi.fn(), ingest: vi.fn(),
  crime: vi.fn(), deprivation: vi.fn(),
}));
vi.mock('@/server/auth/server', () => ({ getUser: fakes.getUser }));
vi.mock('@/server/db/client', () => ({ db: { select: fakes.select } }));
vi.mock('@/server/leads/ingest', () => ({ ingestCandidatesForTenant: fakes.ingest }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/public-data/crime', () => ({ fetchCrimePoints: fakes.crime }));
vi.mock('@/server/public-data/deprivation', () => ({ fetchDeprivation: fakes.deprivation }));

import { requireTenant } from '@/server/auth/tenant';
import * as dealActions from '@/server/actions/deals';
import * as leadActions from '@/server/actions/lead-review';
import { getCrimeHeat, getDeprivation } from '@/server/actions/map-data';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.getUser.mockResolvedValue(null);
  fakes.select.mockReturnValue({ from: () => ({ where: fakes.where }) });
  fakes.where.mockReturnValue({ limit: fakes.limit });
  fakes.limit.mockResolvedValue([]);
});

describe('tenant authorization', () => {
  it('rejects a missing session before database access', async () => {
    await expect(requireTenant()).rejects.toThrow('Not authenticated');
    expect(fakes.select).not.toHaveBeenCalled();
  });

  it('rejects a user without a qualifying membership', async () => {
    fakes.getUser.mockResolvedValue({ id: 'current-user' });
    await expect(requireTenant()).rejects.toThrow('No tenant membership');
  });

  it('only queries this user’s non-deleted, non-suspended memberships', async () => {
    fakes.getUser.mockResolvedValue({ id: 'current-user' });
    fakes.limit.mockResolvedValue([{ tenantId: 'tenant-a' }]);
    await expect(requireTenant()).resolves.toEqual({ userId: 'current-user', tenantId: 'tenant-a' });
    const query = new PgDialect().sqlToQuery(fakes.where.mock.calls[0][0]);
    expect(query.sql).toContain('"memberships"."user_id" =');
    expect(query.sql).toContain('"memberships"."deleted_at" is null');
    expect(query.sql).toContain('"memberships"."role" <>');
    expect(query.params).toEqual(['current-user', 'suspended']);
  });
});

describe('web action boundary', () => {
  it('does not export tenant-selected worker entry points as web actions', () => {
    expect(dealActions).not.toHaveProperty('createDealForTenant');
    expect(dealActions).not.toHaveProperty('requireTenant');
    expect(leadActions).not.toHaveProperty('ingestCandidatesForTenant');
  });

  it('rejects unauthenticated lead and deal creation before any write', async () => {
    await expect(leadActions.ingestCandidates([])).rejects.toThrow('Not authenticated');
    await expect(dealActions.createDeal({ address: 'Example Property', source: 'direct-to-vendor' })).rejects.toThrow('Not authenticated');
    expect(fakes.ingest).not.toHaveBeenCalled();
    expect(fakes.select).not.toHaveBeenCalled();
  });

  it('binds authenticated lead intake to the membership tenant', async () => {
    fakes.getUser.mockResolvedValue({ id: 'current-user' });
    fakes.limit.mockResolvedValue([{ tenantId: 'tenant-a' }]);
    fakes.ingest.mockResolvedValue({ inserted: 0, merged: 0, skipped: 0, errors: [] });
    await leadActions.ingestCandidates([]);
    expect(fakes.ingest).toHaveBeenCalledWith('tenant-a', [], undefined);
  });

  it('denies direct unauthenticated map-data requests before upstream work', async () => {
    await expect(getCrimeHeat(53.5, -1.2)).rejects.toThrow('Not authenticated');
    await expect(getDeprivation(53.5, -1.2)).rejects.toThrow('Not authenticated');
    expect(fakes.crime).not.toHaveBeenCalled();
    expect(fakes.deprivation).not.toHaveBeenCalled();
  });
});
