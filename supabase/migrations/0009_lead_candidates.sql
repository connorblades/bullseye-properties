-- ============================================================================
-- 0009 - lead_candidates (Stage 2 - inbound lead intake + review)
-- ============================================================================
-- Staging table for inbound leads captured from ingestion/sourcing before a
-- partner reviews them. A candidate starts 'pending', then the partner either
-- approves it (promoted to a deal - deal_id is set) or discards it. Mirrors the
-- `deals` tenant/RLS shape so leads are tenant-isolated from day one.
--
-- candidate jsonb holds the full captured payload (raw source fields, enriched
-- public data, scoring detail); the top-level columns (address, postcode,
-- source, fit_pct, client, captured_for) are the review-board projection so the
-- intake list renders without unpacking the jsonb.
--
-- RLS is tenant-scoped, mirroring `deals` (see 0001). The owner connection used
-- by server-side ingestion/promotion bypasses RLS; these policies guard the
-- authenticated/anon API roles.
-- ============================================================================

create table if not exists lead_candidates (
  id            text primary key,                       -- 'lc-<ulid>'
  tenant_id     text not null references tenants(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'discarded')),
  address       text,
  postcode      text,
  source        text,
  fit_pct       integer,
  client        text,
  candidate     jsonb not null default '{}'::jsonb,     -- full captured payload
  deal_id       text references deals(id) on delete set null,  -- set on approve
  captured_for  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   text                                    -- auth.users id or actor label
);

create index if not exists lead_candidates_tenant_status_idx on lead_candidates(tenant_id, status);
create index if not exists lead_candidates_tenant_captured_for_idx on lead_candidates(tenant_id, captured_for);

-- ----------------------------------------------------------------------------
-- RLS - tenant-scoped, mirroring `deals` (see 0001). The owner connection used
-- by the server-side ingestion/promotion path bypasses RLS; these policies
-- guard the authenticated/anon API roles, so a leaked anon key can't read or
-- write here.
-- ----------------------------------------------------------------------------
alter table lead_candidates enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['lead_candidates'])
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
