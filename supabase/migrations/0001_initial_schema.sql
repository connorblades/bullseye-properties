-- ========================================================================
-- Bullseye Platform - Initial schema (M1 Standard Deal Report Generator)
-- ========================================================================
-- Draft v0.1 - aligns with BSE-RPT-P01-PLAN-V1 and Tech Stack Decisions V1.
-- Multi-tenant from day 1 via tenant_id + permissive RLS in M1, tightened in M2.
-- All tables include audit columns. Soft-delete via deleted_at.
-- IDs: ULID-as-text (sortable, URL-safe). Use the `ulid()` extension or
-- generate client-side; this schema treats them as text(26).
-- ========================================================================

-- Extensions ------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Tenants ---------------------------------------------------------------
create table if not exists tenants (
  id              text primary key,
  name            text not null,
  slug            text not null unique,
  status          text not null default 'active' check (status in ('active', 'trial', 'suspended', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Users / membership (Supabase Auth provides auth.users) ----------------
-- A user belongs to one or more tenants with a role.
create table if not exists memberships (
  id              text primary key,
  tenant_id       text not null references tenants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in (
                    'platform_admin', 'owner', 'admin', 'sourcer',
                    'trainee', 'va_analyst', 'investor', 'investor_co_owner',
                    'solicitor', 'suspended'
                  )),
  umbrella_mode   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (tenant_id, user_id)
);

create index if not exists memberships_user_idx on memberships(user_id) where deleted_at is null;
create index if not exists memberships_tenant_role_idx on memberships(tenant_id, role) where deleted_at is null;

-- Partner profile (Section 16 of the Standard Deal Report) -------------
create table if not exists partner_profiles (
  id                   text primary key,
  tenant_id            text not null unique references tenants(id) on delete cascade,
  display_name         text not null,
  accreditation_no     text,
  accredited_at        date,
  aml_registration     text,
  ico_registration     text,
  pi_policy            text,
  brand_logo_url       text,
  avatar_url           text,
  short_bio            text,
  contact_email        text,
  contact_phone        text,
  deals_completed      int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- Investors / clients ---------------------------------------------------
create table if not exists investors (
  id                text primary key,
  tenant_id         text not null references tenants(id) on delete cascade,
  display_name      text not null,
  email             text,
  phone             text,
  base_location     text,
  capital_budget    int,
  ai_consent        boolean not null default false,
  ai_consent_at     timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists investors_tenant_idx on investors(tenant_id) where deleted_at is null;

-- Deals (parent of all per-deal data) -----------------------------------
create table if not exists deals (
  id                text primary key,
  tenant_id         text not null references tenants(id) on delete cascade,
  investor_id       text references investors(id) on delete set null,
  reference         text not null,           -- e.g. BSE-DR-2026-0617-NG18
  address           text not null,
  postcode          text,
  source            text not null check (source in ('estate-agent', 'auction', 'direct-to-vendor')),
  current_stage     int not null default 1,
  delivered         boolean not null default false,
  status            text not null default 'active' check (status in ('active', 'paused', 'completed', 'aborted')),
  inputs            jsonb not null default '{}'::jsonb,  -- full wizard state snapshot (criteria, property, comps, viewing, DD, growth, refurb, financials, offer)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (tenant_id, reference)
);

create index if not exists deals_tenant_idx on deals(tenant_id) where deleted_at is null;
create index if not exists deals_investor_idx on deals(investor_id) where deleted_at is null;
create index if not exists deals_postcode_idx on deals using gin (postcode gin_trgm_ops);

-- Deal report versions (one row per render) -----------------------------
-- Parent = deals row; child = deal_report_versions.
create table if not exists deal_report_versions (
  id                text primary key,
  tenant_id         text not null references tenants(id) on delete cascade,
  deal_id           text not null references deals(id) on delete cascade,
  version           int not null,
  inputs_snapshot   jsonb not null,           -- frozen inputs for byte-for-byte re-render
  pdf_storage_path  text,                     -- supabase://deal-packs/...
  pdf_byte_size     int,
  rendered_at       timestamptz not null default now(),
  rendered_by       uuid references auth.users(id) on delete set null,
  status            text not null default 'rendered' check (status in ('rendering', 'rendered', 'failed', 'archived')),
  failure_reason    text,
  unique (deal_id, version)
);

create index if not exists deal_versions_tenant_idx on deal_report_versions(tenant_id);
create index if not exists deal_versions_deal_idx on deal_report_versions(deal_id);

-- Claude generations audit (PI defence evidence base) -------------------
-- AC-17 of the PLAN. Append-only via permissions (no UPDATE/DELETE grants for app role).
create table if not exists claude_generations (
  id                       text primary key,
  tenant_id                text not null references tenants(id) on delete cascade,
  deal_id                  text not null references deals(id) on delete cascade,
  deal_report_version_id   text references deal_report_versions(id) on delete set null,
  section_key              text not null,         -- e.g. 'why-this-fits', 'location-overview'
  model_id                 text not null,         -- e.g. 'claude-sonnet-4-7-20251001'
  prompt_version_hash      text not null,
  raw_response             bytea,                 -- compressed (gzip)
  partner_edits_diff       text,                  -- unified diff between Claude draft and partner-published version
  input_tokens             int,
  output_tokens            int,
  generated_at             timestamptz not null default now(),
  generated_by             uuid references auth.users(id) on delete set null
);

create index if not exists claude_gen_tenant_idx on claude_generations(tenant_id);
create index if not exists claude_gen_deal_idx on claude_generations(deal_id);
create index if not exists claude_gen_section_idx on claude_generations(section_key);

-- Audit log (compliance + every legally-weighted action) ----------------
-- M2 ships full hash-chain integrity (prev_hash + row_hash via trigger).
-- M1 ships the table + append-only grant; hash chain follows in M2.
create table if not exists audit_log (
  id                text primary key,
  tenant_id         text references tenants(id) on delete cascade,
  actor_user_id     uuid references auth.users(id) on delete set null,
  actor_role        text,
  action            text not null,
  entity_type       text,
  entity_id         text,
  payload           jsonb,
  prev_hash         text,
  row_hash          text,
  recorded_at       timestamptz not null default now()
);

create index if not exists audit_tenant_recorded_idx on audit_log(tenant_id, recorded_at desc);

-- Cost tracking (per-tenant per-day Claude spend ceiling) ---------------
-- AC-20 of the PLAN.
create table if not exists ai_cost_ledger (
  id              text primary key,
  tenant_id       text not null references tenants(id) on delete cascade,
  day             date not null,
  model_id        text not null,
  input_tokens    bigint not null default 0,
  output_tokens   bigint not null default 0,
  estimated_usd   numeric(10,4) not null default 0,
  unique (tenant_id, day, model_id)
);

create index if not exists cost_ledger_tenant_day_idx on ai_cost_ledger(tenant_id, day desc);

-- ========================================================================
-- Row-Level Security
-- ========================================================================
-- M1: RLS enabled with permissive policies (single-tenant; everyone in
-- Connor's tenant can read/write everything in his tenant).
-- M2: tighten to membership-driven policies per role.
-- ========================================================================

alter table tenants                 enable row level security;
alter table memberships             enable row level security;
alter table partner_profiles        enable row level security;
alter table investors               enable row level security;
alter table deals                   enable row level security;
alter table deal_report_versions    enable row level security;
alter table claude_generations      enable row level security;
alter table audit_log               enable row level security;
alter table ai_cost_ledger          enable row level security;

-- Helper: current user's tenant ids
create or replace function auth_user_tenants() returns setof text language sql security definer as $$
  select tenant_id from memberships
  where user_id = auth.uid()
    and deleted_at is null
    and role <> 'suspended'
$$;

-- Permissive tenant-scoped read/write for M1.
-- (In M2 these get split per role.)
-- The `tenants` table is special: it has no `tenant_id` column - its `id` IS
-- the tenant id - so it gets its own policy below.
do $$
declare t text;
begin
  for t in select unnest(array[
    'memberships','partner_profiles','investors','deals',
    'deal_report_versions','claude_generations','ai_cost_ledger'
  ])
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

-- Tenants: a user can read/update tenants they're a member of.
-- Insert is restricted to platform_admin (in M1, that's Connor's first user).
drop policy if exists "tenant_read_tenants" on tenants;
create policy "tenant_read_tenants" on tenants for select
  using (
    id in (select auth_user_tenants())
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.role = 'platform_admin'
        and m.deleted_at is null
    )
  );

drop policy if exists "tenant_write_tenants" on tenants;
create policy "tenant_write_tenants" on tenants for insert
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.role = 'platform_admin'
        and m.deleted_at is null
    )
  );

drop policy if exists "tenant_update_tenants" on tenants;
create policy "tenant_update_tenants" on tenants for update
  using (
    id in (select auth_user_tenants())
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.role = 'platform_admin'
        and m.deleted_at is null
    )
  );

-- Audit log: append-only. Reads scoped to tenant; no updates, no deletes.
drop policy if exists "audit_read" on audit_log;
create policy "audit_read" on audit_log for select
  using (tenant_id in (select auth_user_tenants()));

drop policy if exists "audit_insert" on audit_log;
create policy "audit_insert" on audit_log for insert
  with check (tenant_id in (select auth_user_tenants()));

-- Revoke updates/deletes from app role (would be set in roles config; documented here for clarity)
-- revoke update, delete on audit_log from authenticated, anon;
-- revoke update, delete on claude_generations from authenticated, anon;

-- Updated-at trigger ----------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'tenants','memberships','partner_profiles','investors','deals'
  ])
  loop
    execute format($f$
      drop trigger if exists trg_updated_at_%I on %I;
      create trigger trg_updated_at_%I before update on %I
        for each row execute function set_updated_at();
    $f$, t, t, t, t);
  end loop;
end$$;
