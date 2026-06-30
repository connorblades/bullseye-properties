-- ============================================================================
-- 0008 - share_tokens + share_token_events (M4-T1 - secure investor delivery)
-- ============================================================================
-- Revocable, expiring, per-link share tokens that gate the public delivery
-- surfaces:
--   - kind 'outline' -> Report 1 (the pre-viewing Outline pack at /o/[token])
--   - kind 'report'  -> Report 2 (the full Standard Deal Report at /r/[token])
--
-- The raw secret (32 random bytes, base64url) lives only in the URL and is
-- shown to the partner once. Only its SHA-256 hash is stored, so a DB leak
-- does not expose working links. Resolution hashes the inbound token and looks
-- it up by token_hash via the owner connection (no session) - mirroring the
-- existing loadDealPublic path - then checks revoked_at / expires_at and logs
-- the access. Partner management (create / revoke / list) is tenant-scoped at
-- the app layer through requireTenant; RLS policies below mirror `deals`.
--
-- Not a signed JWT: revocation + per-open access logging mean every access
-- hits the DB regardless, so a stateful random token is simpler and safer than
-- a JWT-plus-denylist. Unguessability is 256 bits of entropy.
-- ============================================================================

create table if not exists share_tokens (
  id                  text primary key,                       -- 'sht-<ulid>'
  tenant_id           text not null references tenants(id) on delete cascade,
  deal_id             text not null references deals(id) on delete cascade,
  kind                text not null,                          -- 'outline' | 'report'
  token_hash          text not null unique,                   -- sha256(secret), hex
  report_version_id   text references deal_report_versions(id) on delete set null,
  label               text,                                   -- optional human label
  recipient_email     text,                                   -- who it was issued to
  expires_at          timestamptz,                            -- null = never expires
  revoked_at          timestamptz,                            -- null = active
  last_accessed_at    timestamptz,
  access_count        integer not null default 0,
  created_at          timestamptz not null default now(),
  created_by          uuid                                    -- auth.users id
);

create index if not exists share_tokens_deal_idx on share_tokens(deal_id);
create index if not exists share_tokens_tenant_idx on share_tokens(tenant_id);

create table if not exists share_token_events (
  id            text primary key,                             -- 'ste-<ulid>'
  token_id      text not null references share_tokens(id) on delete cascade,
  tenant_id     text not null references tenants(id) on delete cascade,
  event         text not null,                                -- 'open' | 'download'
  ip_hash       text,                                         -- sha256(ip + salt)
  user_agent    text,
  occurred_at   timestamptz not null default now()
);

create index if not exists share_token_events_token_idx on share_token_events(token_id, occurred_at desc);
create index if not exists share_token_events_tenant_idx on share_token_events(tenant_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- RLS - tenant-scoped, mirroring `deals` (see 0001). The owner connection used
-- by the public resolution path bypasses RLS; these policies guard the
-- authenticated/anon API roles, so a leaked anon key can't read or write here.
-- ----------------------------------------------------------------------------
alter table share_tokens        enable row level security;
alter table share_token_events  enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['share_tokens','share_token_events'])
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
