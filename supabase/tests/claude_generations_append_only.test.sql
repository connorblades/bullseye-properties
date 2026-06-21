-- ============================================================================
-- pgTAP: claude_generations is append-only for the authenticated role (M3-T5)
-- ============================================================================
-- Run with:  supabase test db
-- (requires the pgtap extension; `create extension if not exists pgtap;`)
--
-- Asserts the DoD for AC-07: the API role can INSERT and SELECT generation
-- rows, but UPDATE and DELETE are forbidden (permission denied).
-- ============================================================================

begin;
select plan(4);

-- Privilege checks against the `authenticated` role.
select ok(
  has_table_privilege('authenticated', 'public.claude_generations', 'INSERT'),
  'authenticated retains INSERT on claude_generations'
);
select ok(
  has_table_privilege('authenticated', 'public.claude_generations', 'SELECT'),
  'authenticated retains SELECT on claude_generations'
);
select ok(
  not has_table_privilege('authenticated', 'public.claude_generations', 'UPDATE'),
  'authenticated CANNOT UPDATE claude_generations (append-only)'
);
select ok(
  not has_table_privilege('authenticated', 'public.claude_generations', 'DELETE'),
  'authenticated CANNOT DELETE claude_generations (append-only)'
);

select * from finish();
rollback;
