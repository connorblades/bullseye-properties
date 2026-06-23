-- ============================================================================
-- 0005 - land_ownership (HMLR CCOD/OCOD corporate ownership) - open-data expansion
-- ============================================================================
-- Tenant-agnostic reference data, like public_data_cache: ingested from HM Land
-- Registry's free Commercial & Corporate Ownership Data (CCOD) + Overseas (OCOD)
-- datasets and queried per-deal by postcode. Populated by the ingest-land-data
-- Trigger.dev task (filtered to Bullseye's operating postcode areas to keep the
-- table lean). Written/read via the direct (owner) connection; RLS is on with no
-- policies so the API roles can't read it.
--
-- Free per HMLR: CCOD/OCOD are OGL and free of charge. Individual private-owner
-- title is NOT in this data (paid, per-title) - this covers company owners only.
-- ============================================================================

create table if not exists land_ownership (
  id                text primary key,
  dataset           text not null,                 -- 'ccod' | 'ocod'
  title_number      text not null,
  tenure            text,
  postcode          text,
  address           text,
  district          text,
  price_paid        bigint,
  proprietors       jsonb not null default '[]'::jsonb,  -- [{name, companyRegNo, category, country}]
  updated_at        timestamptz not null default now()
);

create index if not exists land_ownership_postcode_idx on land_ownership (postcode);
create unique index if not exists land_ownership_dataset_title_unique on land_ownership (dataset, title_number);

alter table land_ownership enable row level security;
