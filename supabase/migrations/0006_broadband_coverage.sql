-- ============================================================================
-- 0006 - broadband_coverage (Ofcom Connected Nations) - open-data expansion
-- ============================================================================
-- Tenant-agnostic reference data, like land_ownership: ingested from Ofcom's
-- free Connected Nations fixed-broadband postcode dataset and queried per-deal
-- by postcode. Populated by the ingest-broadband Trigger.dev task (filtered to
-- Bullseye's operating postcode areas). Ofcom publishes per-release CSVs (no
-- stable API), so the ingest source URL is supplied via OFCOM_BROADBAND_CSV_URL.
-- Server-only: RLS on with no policies; the direct connection bypasses it.
-- ============================================================================

create table if not exists broadband_coverage (
  id                  text primary key,        -- postcode (normalised)
  postcode            text not null,
  max_download_mbps   integer,
  superfast_pct       numeric(5,1),            -- % premises >= 30 Mbit/s
  ultrafast_pct       numeric(5,1),            -- % premises >= 300 Mbit/s
  full_fibre_pct      numeric(5,1),            -- % premises with FTTP
  premises            integer,
  updated_at          timestamptz not null default now()
);

create index if not exists broadband_coverage_postcode_idx on broadband_coverage (postcode);

alter table broadband_coverage enable row level security;
