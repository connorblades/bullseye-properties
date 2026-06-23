-- ============================================================================
-- 0007 - land_boundary (HMLR INSPIRE freehold boundary polygons) - open data
-- ============================================================================
-- Plot boundary polygons from HM Land Registry's free INSPIRE Index Polygons
-- (OGL), ingested per local authority by the ingest-boundaries Trigger task and
-- queried per-deal by point-in-polygon. Geometry is stored in the INSPIRE
-- native CRS (British National Grid, EPSG:27700) and transformed to WGS84 on
-- read. Server-only: RLS on with no policies; the direct connection bypasses it.
--
-- Requires the PostGIS extension. On Supabase, enable it once (Dashboard ->
-- Database -> Extensions -> postgis) if `create extension` is not permitted via
-- SQL for your role.
-- ============================================================================

create extension if not exists postgis;

create table if not exists land_boundary (
  id                text primary key,    -- INSPIRE ID
  local_authority   text,
  geom              geometry,            -- INSPIRE native CRS (EPSG:27700)
  updated_at        timestamptz not null default now()
);

create index if not exists land_boundary_geom_idx on land_boundary using gist (geom);

alter table land_boundary enable row level security;
