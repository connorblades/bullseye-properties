import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Real PostgreSQL policy execution in disposable memory; no production access.
const sql = new PGlite();
const member = '00000000-0000-0000-0000-000000000001';
const outsider = '00000000-0000-0000-0000-000000000002';
const suspended = '00000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000004';
let originalFailure = '';

async function asUser(id: string, role = 'authenticated') {
  await sql.exec('reset role');
  await sql.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await sql.exec(`set role ${role}`);
}

beforeAll(async () => {
  await sql.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon, service_role;
  `);
  // Extensions/index omitted only for the WASM harness; table and RLS SQL is
  // loaded from the real migration without policy substitutions.
  const initial = readFileSync(path.resolve('../../supabase/migrations/0001_initial_schema.sql'), 'utf8')
    .replace(/^create extension .*;$/gm, '')
    .replace(/^create index .*gin_trgm_ops.*;$/gm, '');
  await sql.exec(initial);
  await sql.exec(`
    grant usage on schema public to authenticated, anon, service_role;
    grant all on all tables in schema public to authenticated, anon, service_role;
    insert into auth.users values ('${member}'), ('${outsider}'), ('${suspended}'), ('${admin}');
    insert into tenants(id, name, slug) values ('a', 'Tenant A', 'a'), ('b', 'Tenant B', 'b');
    insert into memberships(id, tenant_id, user_id, role) values
      ('member-a', 'a', '${member}', 'sourcer'),
      ('member-b', 'b', '${outsider}', 'sourcer'),
      ('suspended-a', 'a', '${suspended}', 'suspended'),
      ('admin-a', 'a', '${admin}', 'platform_admin');
    insert into deals(id, tenant_id, reference, address, source) values
      ('deal-a', 'a', 'A-001', 'Test property A', 'direct-to-vendor'),
      ('deal-b', 'b', 'B-001', 'Test property B', 'direct-to-vendor');
  `);
  await asUser(member);
  try { await sql.query('select id from memberships'); }
  catch (error) { originalFailure = (error as Error).message; }
  await sql.exec('reset role');
  await sql.exec(readFileSync(path.resolve('../../supabase/migrations/20261108003000_membership_access_controls.sql'), 'utf8'));
}, 30_000);

beforeEach(async () => { await asUser(member); });
afterAll(async () => { await sql.close(); });

describe('membership policy repair', () => {
  it('reproduces recursive membership reads in the original policy', () => {
    expect(originalFailure).toContain('infinite recursion');
  });

  it('lets a partner read its own tenant without leaking another tenant', async () => {
    const memberships = await sql.query<{ tenant_id: string }>('select tenant_id from memberships');
    expect(memberships.rows.length).toBeGreaterThan(0);
    expect(memberships.rows.every((row) => row.tenant_id === 'a')).toBe(true);
    const deals = await sql.query('select id from deals');
    expect(deals.rows).toEqual([{ id: 'deal-a' }]);
  });

  it('denies self-promotion to platform administrator', async () => {
    await expect(sql.query("update memberships set role = 'platform_admin' where id = 'member-a'"))
      .rejects.toThrow('permission denied');
  });

  it('denies creating privileged memberships and deleting other members', async () => {
    await expect(sql.query(`insert into memberships(id, tenant_id, user_id, role)
      values ('escalated', 'a', '${outsider}', 'platform_admin')`)).rejects.toThrow('permission denied');
    await expect(sql.query("delete from memberships where id = 'admin-a'"))
      .rejects.toThrow('permission denied');
  });

  it('hides tenant data from a suspended membership', async () => {
    await asUser(suspended);
    expect((await sql.query('select id from deals')).rows).toEqual([]);
    expect((await sql.query('select id from memberships')).rows).toEqual([]);
  });

  it('preserves the existing platform administrator read scope', async () => {
    await asUser(admin);
    expect((await sql.query('select id from deals order by id')).rows)
      .toEqual([{ id: 'deal-a' }, { id: 'deal-b' }]);
  });

  it('does not expose membership rows to anonymous callers', async () => {
    await asUser('', 'anon');
    expect((await sql.query('select id from memberships')).rows).toEqual([]);
  });

  it('preserves trusted service-role membership administration', async () => {
    await asUser('', 'service_role');
    const result = await sql.query("update memberships set role = 'sourcer' where id = 'member-a' returning id");
    expect(result.rows).toEqual([{ id: 'member-a' }]);
  });
});
