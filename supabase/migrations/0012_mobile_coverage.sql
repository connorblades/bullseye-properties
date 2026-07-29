-- ============================================================================
-- 0012 - mobile_coverage (Ofcom Connected Nations, mobile) - open-data expansion
-- ============================================================================
-- Tenant-agnostic reference data, like broadband_coverage. Ofcom's FREE bulk
-- mobile coverage download is aggregated at LOCAL AUTHORITY level (the `laua`
-- GSS code), NOT postcode - postcode/address-level mobile needs Ofcom's
-- signup-gated API, which fails the "free, no signup" bar. So this table is
-- keyed on the LA GSS code that the orchestrator already supplies as
-- districtCode. Percentages are of PREMISES: `pct` = covered by at least one of
-- the four MNOs, `all_pct` = covered by all four. Populated by the
-- ingest-mobile-coverage Trigger.dev task; source URL via OFCOM_MOBILE_CSV_URL.
-- Server-only: RLS on with no policies; the direct connection bypasses it.
-- ============================================================================

create table if not exists mobile_coverage (
  id                        text primary key,     -- local authority GSS code (laua)
  area_name                 text,
  four_g_indoor_pct         numeric(5,1),         -- % premises indoor 4G, >= 1 operator
  four_g_indoor_all_pct     numeric(5,1),         -- % premises indoor 4G, all four operators
  four_g_outdoor_pct        numeric(5,1),         -- % premises outdoor 4G, >= 1 operator
  five_g_outdoor_pct        numeric(5,1),         -- % premises outdoor 5G (high confidence), >= 1 operator
  five_g_outdoor_all_pct    numeric(5,1),         -- % premises outdoor 5G (high confidence), all four operators
  updated_at                timestamptz not null default now()
);

alter table mobile_coverage enable row level security;
