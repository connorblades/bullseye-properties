/**
 * Drizzle schema for the Bullseye Platform.
 *
 * Mirrors supabase/migrations/0001_initial_schema.sql. The migration is the
 * source of truth for the underlying Postgres tables, indexes, and RLS
 * policies. This file is the type-safe surface that application code uses.
 *
 * When the migration changes, update this file in the same PR and run
 * `pnpm db:generate` to refresh inferred types.
 */

import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  numeric,
  date,
  timestamp,
  boolean,
  jsonb,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Postgres bytea type - Drizzle doesn't ship a built-in one.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tenants
// ─────────────────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Memberships - a user belongs to one or more tenants with a role
// ─────────────────────────────────────────────────────────────────────────────
export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),  // FK to auth.users (Supabase)
    role: text('role').notNull(),
    umbrellaMode: boolean('umbrella_mode').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('memberships_user_idx').on(table.userId),
    tenantRoleIdx: index('memberships_tenant_role_idx').on(table.tenantId, table.role),
    uniqueTenantUser: uniqueIndex('memberships_tenant_user_unique').on(table.tenantId, table.userId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Partner profiles - Section 16 of every Standard Deal Report
// ─────────────────────────────────────────────────────────────────────────────
export const partnerProfiles = pgTable('partner_profiles', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  accreditationNo: text('accreditation_no'),
  accreditedAt: date('accredited_at'),
  amlRegistration: text('aml_registration'),
  icoRegistration: text('ico_registration'),
  piPolicy: text('pi_policy'),
  brandLogoUrl: text('brand_logo_url'),
  avatarUrl: text('avatar_url'),
  shortBio: text('short_bio'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  dealsCompleted: integer('deals_completed').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Investors / clients
// ─────────────────────────────────────────────────────────────────────────────
export const investors = pgTable(
  'investors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    baseLocation: text('base_location'),
    capitalBudget: integer('capital_budget'),
    aiConsent: boolean('ai_consent').notNull().default(false),
    aiConsentAt: timestamp('ai_consent_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('investors_tenant_idx').on(table.tenantId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Deals (parent of all per-deal data)
// ─────────────────────────────────────────────────────────────────────────────
export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    investorId: text('investor_id').references(() => investors.id, { onDelete: 'set null' }),
    reference: text('reference').notNull(),  // BSE-CB-001-001
    address: text('address').notNull(),
    postcode: text('postcode'),
    source: text('source').notNull(),
    currentStage: integer('current_stage').notNull().default(1),
    delivered: boolean('delivered').notNull().default(false),
    status: text('status').notNull().default('active'),
    inputs: jsonb('inputs').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('deals_tenant_idx').on(table.tenantId),
    investorIdx: index('deals_investor_idx').on(table.investorId),
    uniqueTenantRef: uniqueIndex('deals_tenant_ref_unique').on(table.tenantId, table.reference),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Deal report versions (one row per render)
// ─────────────────────────────────────────────────────────────────────────────
export const dealReportVersions = pgTable(
  'deal_report_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    inputsSnapshot: jsonb('inputs_snapshot').notNull(),
    pdfStoragePath: text('pdf_storage_path'),
    pdfByteSize: integer('pdf_byte_size'),
    renderedAt: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
    renderedBy: uuid('rendered_by'),
    status: text('status').notNull().default('rendered'),
    failureReason: text('failure_reason'),
  },
  (table) => ({
    tenantIdx: index('deal_versions_tenant_idx').on(table.tenantId),
    dealIdx: index('deal_versions_deal_idx').on(table.dealId),
    uniqueDealVersion: uniqueIndex('deal_versions_deal_version_unique').on(table.dealId, table.version),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Claude generations audit (append-only, PI defence evidence base)
// ─────────────────────────────────────────────────────────────────────────────
export const claudeGenerations = pgTable(
  'claude_generations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    dealReportVersionId: text('deal_report_version_id').references(() => dealReportVersions.id, { onDelete: 'set null' }),
    sectionKey: text('section_key').notNull(),
    modelId: text('model_id').notNull(),
    promptVersionHash: text('prompt_version_hash').notNull(),
    rawResponse: bytea('raw_response'),
    partnerEditsDiff: text('partner_edits_diff'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid('generated_by'),
  },
  (table) => ({
    tenantIdx: index('claude_gen_tenant_idx').on(table.tenantId),
    dealIdx: index('claude_gen_deal_idx').on(table.dealId),
    sectionIdx: index('claude_gen_section_idx').on(table.sectionKey),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    payload: jsonb('payload'),
    prevHash: text('prev_hash'),
    rowHash: text('row_hash'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantRecordedIdx: index('audit_tenant_recorded_idx').on(table.tenantId, table.recordedAt),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AI cost ledger
// ─────────────────────────────────────────────────────────────────────────────
export const aiCostLedger = pgTable(
  'ai_cost_ledger',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    modelId: text('model_id').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    estimatedUsd: numeric('estimated_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  },
  (table) => ({
    tenantDayIdx: index('cost_ledger_tenant_day_idx').on(table.tenantId, table.day),
    uniqueTenantDayModel: uniqueIndex('cost_ledger_tenant_day_model_unique').on(table.tenantId, table.day, table.modelId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Public data cache (M2) - shared, tenant-agnostic key/value cache for all
// public-data integrations. TTL carried per-row in expiresAt. Server-only:
// RLS is on with no policies; the direct connection bypasses it.
// ─────────────────────────────────────────────────────────────────────────────
export const publicDataCache = pgTable(
  'public_data_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    source: text('source').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    sourceIdx: index('public_data_cache_source_idx').on(table.source),
    expiresIdx: index('public_data_cache_expires_idx').on(table.expiresAt),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Land ownership (HMLR CCOD/OCOD corporate ownership) - tenant-agnostic
// reference data, ingested from the free HMLR datasets and queried by postcode.
// Server-only: RLS on with no policies; the direct connection bypasses it.
// ─────────────────────────────────────────────────────────────────────────────
export const landOwnership = pgTable(
  'land_ownership',
  {
    id: text('id').primaryKey(),
    dataset: text('dataset').notNull(), // 'ccod' | 'ocod'
    titleNumber: text('title_number').notNull(),
    tenure: text('tenure'),
    postcode: text('postcode'),
    address: text('address'),
    district: text('district'),
    pricePaid: bigint('price_paid', { mode: 'number' }),
    proprietors: jsonb('proprietors').notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postcodeIdx: index('land_ownership_postcode_idx').on(table.postcode),
    datasetTitleUnique: uniqueIndex('land_ownership_dataset_title_unique').on(table.dataset, table.titleNumber),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Broadband coverage (Ofcom Connected Nations) - tenant-agnostic reference data,
// ingested from the free Ofcom fixed-broadband postcode dataset, queried by
// postcode. Server-only: RLS on with no policies; direct connection bypasses it.
// ─────────────────────────────────────────────────────────────────────────────
export const broadbandCoverage = pgTable(
  'broadband_coverage',
  {
    id: text('id').primaryKey(), // normalised postcode
    postcode: text('postcode').notNull(),
    maxDownloadMbps: integer('max_download_mbps'),
    superfastPct: numeric('superfast_pct', { precision: 5, scale: 1 }),
    ultrafastPct: numeric('ultrafast_pct', { precision: 5, scale: 1 }),
    fullFibrePct: numeric('full_fibre_pct', { precision: 5, scale: 1 }),
    premises: integer('premises'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postcodeIdx: index('broadband_coverage_postcode_idx').on(table.postcode),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Share tokens (M4) - revocable, expiring per-link tokens gating the public
// delivery surfaces: kind 'outline' -> Report 1 (/o/[token]), kind 'report' ->
// Report 2 (/r/[token]). Only the SHA-256 hash of the secret is stored. RLS on
// with tenant-scoped policies (see 0008); the owner connection used by the
// public resolution path bypasses RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const shareTokens = pgTable(
  'share_tokens',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'outline' | 'report'
    tokenHash: text('token_hash').notNull().unique(),
    reportVersionId: text('report_version_id').references(() => dealReportVersions.id, { onDelete: 'set null' }),
    label: text('label'),
    recipientEmail: text('recipient_email'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    accessCount: integer('access_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => ({
    dealIdx: index('share_tokens_deal_idx').on(table.dealId),
    tenantIdx: index('share_tokens_tenant_idx').on(table.tenantId),
  })
);

export const shareTokenEvents = pgTable(
  'share_token_events',
  {
    id: text('id').primaryKey(),
    tokenId: text('token_id').notNull().references(() => shareTokens.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    event: text('event').notNull(), // 'open' | 'download'
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: index('share_token_events_token_idx').on(table.tokenId, table.occurredAt),
    tenantIdx: index('share_token_events_tenant_idx').on(table.tenantId, table.occurredAt),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Lead candidates (Stage 2) - inbound lead intake staging. Rows are captured
// from ingestion/sourcing, reviewed by a partner, then approved (promoted to a
// deal) or discarded. Mirrors the deals tenant/RLS shape. dealId is set when a
// candidate is approved and promoted. RLS on with tenant-scoped policies
// mirroring `deals`; the owner connection bypasses RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const leadCandidates = pgTable(
  'lead_candidates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'discarded'
    address: text('address'),
    postcode: text('postcode'),
    source: text('source'),
    fitPct: integer('fit_pct'),
    client: text('client'),
    candidate: jsonb('candidate').notNull().default(sql`'{}'::jsonb`),
    dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    capturedFor: date('captured_for'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
  },
  (table) => ({
    tenantStatusIdx: index('lead_candidates_tenant_status_idx').on(table.tenantId, table.status),
    tenantCapturedForIdx: index('lead_candidates_tenant_captured_for_idx').on(table.tenantId, table.capturedFor),
  })
);

// Inferred types for application code
export type Tenant = typeof tenants.$inferSelect;
export type LeadCandidate = typeof leadCandidates.$inferSelect;
export type NewLeadCandidate = typeof leadCandidates.$inferInsert;
export type PublicDataCacheRow = typeof publicDataCache.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type ShareToken = typeof shareTokens.$inferSelect;
export type NewShareToken = typeof shareTokens.$inferInsert;
export type ShareTokenEvent = typeof shareTokenEvents.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DealReportVersion = typeof dealReportVersions.$inferSelect;
export type ClaudeGeneration = typeof claudeGenerations.$inferSelect;
