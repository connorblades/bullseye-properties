-- ========================================================================
-- Bullseye Platform - Public data cache (M2 Public data integrations)
-- ========================================================================
-- A single shared key/value cache for all public-data integrations:
-- HPI (Land Registry), crime (data.police.uk), flood (Environment Agency),
-- amenities (OSM Overpass + OSRM), geocode (postcodes.io), and the Mapbox
-- static-map URLs. Public data is identical across tenants, so this table is
-- intentionally NOT tenant-scoped.
--
-- Access is server-only via the direct DATABASE_URL connection (which bypasses
-- RLS). RLS is enabled with no policies so the authenticated/anon roles can
-- neither read nor write it directly.
--
-- TTL is carried per-row in expires_at; the fetchers compute it from the
-- per-source window in BSE-RPT-P01-BUILD-V1 §7 (HPI 24h, crime 24h, flood 30d,
-- amenities 7d, geocode 30d, maps 30d).
-- ========================================================================

create table if not exists public_data_cache (
  cache_key   text primary key,            -- e.g. 'flood:NG18 5PH', 'crime:53.15,-1.18:2026-05'
  source      text not null,               -- 'geocode' | 'hpi' | 'crime' | 'flood' | 'amenities' | 'maps'
  payload     jsonb not null,              -- normalised result shape
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists public_data_cache_source_idx on public_data_cache(source);
create index if not exists public_data_cache_expires_idx on public_data_cache(expires_at);

alter table public_data_cache enable row level security;
-- No policies: the authenticated and anon roles get no access. Only the
-- server's direct connection (which bypasses RLS) reads and writes this table.
