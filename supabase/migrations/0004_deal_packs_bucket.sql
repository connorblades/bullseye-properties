-- ============================================================================
-- 0004 - deal-packs storage bucket (M3-T10)
-- ============================================================================
-- Private bucket holding rendered Standard Deal Report PDFs, keyed
-- {tenant_id}/{deal_id}/v{n}.pdf. Writes happen server-side via the service
-- role (bypasses storage RLS); downloads are served through short-lived signed
-- URLs. The tracked investor share link (M4-T1) issues a 90-day signed URL.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('deal-packs', 'deal-packs', false)
on conflict (id) do nothing;
