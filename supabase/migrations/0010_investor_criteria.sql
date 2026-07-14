-- ============================================================================
-- 0010 - investor_criteria (BSE-OPP-P01 M1 - network investor-criteria store)
-- ============================================================================
-- The network's investor briefs, tenant-scoped. Every lead ingested into the
-- review queue is scored against every active row here, so the inbox can show
-- "N% fit for [Investor]" instead of "0% fit", and an approved lead carries the
-- best-matched investor onto the pipeline deal.
--
-- Criteria are stored as free text mirroring the `Deal.criteria` contract
-- (budget "£350,000", target_yield "7%", areas as a comma list) so the same
-- pure `scoreLeadFit` logic scores a lead against an investor with no
-- conversion. `name` is the investor's display name; `strategy` is a free-text
-- brief (e.g. "BTL", "BRR", "flip"). `active` excludes an investor from
-- matching without deleting the row.
--
-- RLS is tenant-scoped, mirroring `deals` (see 0001) and `lead_candidates`
-- (0009). The owner connection used by the server-side matching/ingestion path
-- bypasses RLS; these policies guard the authenticated/anon API roles, so a
-- leaked anon key can neither read another tenant's briefs nor write here.
-- ============================================================================

create table if not exists investor_criteria (
  id            text primary key,                       -- 'ic-<ulid>'
  tenant_id     text not null references tenants(id) on delete cascade,
  name          text not null,                          -- investor display name
  budget        text,                                   -- e.g. "£350,000", "350k"
  areas         text,                                   -- comma list of towns/areas
  property_type text,                                   -- e.g. "Terraced, Semi"
  target_yield  text,                                   -- e.g. "7%", "7"
  strategy      text,                                   -- free-text brief (BTL/BRR/flip)
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists investor_criteria_tenant_idx on investor_criteria(tenant_id);
create index if not exists investor_criteria_tenant_active_idx on investor_criteria(tenant_id, active);

-- ----------------------------------------------------------------------------
-- RLS - tenant-scoped, mirroring `deals` (0001) and `lead_candidates` (0009).
-- The owner connection used by the server-side matching/ingestion path bypasses
-- RLS; these policies guard the authenticated/anon API roles.
-- ----------------------------------------------------------------------------
alter table investor_criteria enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['investor_criteria'])
  loop
    execute format($f$
      drop policy if exists "tenant_read_%I" on %I;
      create policy "tenant_read_%I" on %I for select
        using (
          tenant_id in (select auth_user_tenants())
          or exists (
            select 1 from memberships m
            where m.user_id = auth.uid()
              and m.role = 'platform_admin'
              and m.deleted_at is null
          )
        );
      drop policy if exists "tenant_write_%I" on %I;
      create policy "tenant_write_%I" on %I for insert
        with check (tenant_id in (select auth_user_tenants()));
      drop policy if exists "tenant_update_%I" on %I;
      create policy "tenant_update_%I" on %I for update
        using (tenant_id in (select auth_user_tenants()));
    $f$, t, t, t, t, t, t, t, t, t, t, t, t);
  end loop;
end$$;
