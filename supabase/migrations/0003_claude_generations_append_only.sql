-- ============================================================================
-- 0003 - claude_generations append-only enforcement (M3-T5 / AC-07)
-- ============================================================================
-- The 0001 schema enabled RLS on claude_generations but generated a permissive
-- tenant_update policy for it (via the shared loop) and only *documented* the
-- revoke as a comment. This migration makes the table genuinely append-only for
-- the API role: rows can be INSERTed and SELECTed, never UPDATEd or DELETEd.
--
-- The application writes via the direct (owner) connection, which bypasses RLS;
-- this enforcement protects the `authenticated` (PostgREST/JWT) surface, which
-- is the tamper vector the PI-defence audit trail must resist.
-- ============================================================================

-- Drop the permissive update policy 0001 created for this table.
drop policy if exists "tenant_update_claude_generations" on claude_generations;

-- Hard-revoke write-after-insert privileges from the API roles so an UPDATE or
-- DELETE attempt errors (permission denied) rather than silently affecting zero
-- rows. INSERT + SELECT remain (granted by Supabase defaults / 0001 policies).
revoke update, delete on claude_generations from authenticated;
revoke update, delete on claude_generations from anon;

-- audit_log was never given an update policy in 0001, but revoke for symmetry so
-- both PI-defence tables are provably append-only.
revoke update, delete on audit_log from authenticated;
revoke update, delete on audit_log from anon;
