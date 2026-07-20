-- ============================================================================
-- 0011 - patch-index storage bucket (BSE-OPP-P01 M5 - cloud index hosting)
-- ============================================================================
-- Private bucket holding the SERIALIZED Deal Radar patch index (the comp index +
-- the propensity signal tables), published from Connor's Mac on each ~monthly
-- data refresh and loaded by the in-platform on-market discount / off-market
-- negotiability scorers when the raw ~4.7GB Land Registry / EPC / CCOD-OCOD /
-- Companies House files are absent (the cloud - Vercel ingest + Trigger runs).
--
-- The artifact is the DERIVED patch slice only (orders of magnitude smaller than
-- the raw inputs) and carries NO person-level fields (pscName / approachTarget)
-- while the deceased-estates / PSC gate is off - the serialiser drops them, so
-- the GDPR gate holds in the cloud exactly as it does locally.
--
-- Object key: `patch-index/{version}.json.gz` plus a `patch-index/latest.json`
-- pointer. Writes happen server-side via the service role (bypasses storage RLS,
-- mirroring the deal-packs bucket in 0004); reads are server / service-role only
-- and the bucket is private, so no object is ever exposed to the client bundle.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('patch-index', 'patch-index', false)
on conflict (id) do nothing;
