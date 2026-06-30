-- ============================================================================
-- pgTAP: share_tokens + share_token_events are tenant-scoped under RLS (M4-T5)
-- ============================================================================
-- Run with:  supabase test db
-- (requires the pgtap extension; `create extension if not exists pgtap;`)
--
-- The public share-resolution path uses the owner connection (bypasses RLS) and
-- looks tokens up by their SHA-256 hash. These assertions guard the OTHER side:
-- the API roles (authenticated/anon) must only ever reach rows through the
-- tenant-scoped policies, so a leaked anon key cannot read or enumerate tokens.
-- ============================================================================

begin;
select plan(6);

-- RLS must be enabled on both tables.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.share_tokens'::regclass),
  'RLS is enabled on share_tokens'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.share_token_events'::regclass),
  'RLS is enabled on share_token_events'
);

-- Tenant-scoped policies exist (created by the 0008 do-block).
select ok(
  exists (select 1 from pg_policies where tablename = 'share_tokens' and policyname = 'tenant_read_share_tokens'),
  'share_tokens has a tenant_read policy'
);
select ok(
  exists (select 1 from pg_policies where tablename = 'share_tokens' and policyname = 'tenant_write_share_tokens'),
  'share_tokens has a tenant_write policy'
);
select ok(
  exists (select 1 from pg_policies where tablename = 'share_token_events' and policyname = 'tenant_read_share_token_events'),
  'share_token_events has a tenant_read policy'
);

-- The anon role must not hold blanket table privileges that bypass intent.
select ok(
  not has_table_privilege('anon', 'public.share_tokens', 'DELETE'),
  'anon cannot DELETE share_tokens'
);

select * from finish();
rollback;
