import { task, logger } from '@trigger.dev/sdk';
import { runDealRadarScore } from '@/server/deal-radar/ingest-stock';

/**
 * deal-radar-score: batch-score the standing housing stock for motivated-seller
 * propensity from open data (Land Registry, EPC, HMLR CCOD/OCOD, Companies
 * House) and emit the top matches as candidates into the M7 Deal Review inbox.
 *
 * Long-running (streams the multi-GB local files, never buffering them). The
 * tenant has no auth session in a Trigger run, so the target tenant is passed
 * explicitly (payload.tenantId or RDR_TENANT_ID) and queued via the additive
 * ingestCandidatesForTenant seam. Env: RDR_DATA_DIR, RDR_LR_DISTRICTS,
 * RDR_TOP_N, RDR_MIN_CONFIDENCE, RDR_HPI_FACTOR, RDR_TENANT_ID.
 *
 * M10 distress-signal enrichment (all fail-soft; a source outage never breaks a
 * run). Off by default; opt in via env:
 *   - RDR_GAZETTE_ENABLE=true       enable the Gazette insolvency-notices fetch
 *   - RDR_GAZETTE_BASE              Gazette API base (default www.thegazette.co.uk)
 *   - RDR_GAZETTE_RADIUS_MILES      postcode-radius per seed (default 15)
 *   - RDR_GAZETTE_MAX_SEEDS         cap on seed postcodes per run (default 12)
 *   - RDR_PSC_ENABLE=true           enable Companies House PSC lookups (needs
 *                                   COMPANIES_HOUSE_API_KEY); company-level only
 *   - RDR_PSC_MAX                   cap on PSC lookups per run (default 500)
 *   - RDR_TAXBASE_FILE              Council Taxbase empty-homes CSV extract
 * PERSON-LEVEL, GDPR-GATED, OFF BY DEFAULT (do NOT set without a documented UK
 * GDPR lawful-basis review; see distress-sources.ts):
 *   - RDR_ENABLE_DECEASED_ESTATES=true  the Gazette deceased-estates (probate)
 *                                   person-level fetcher. The default run ingests
 *                                   no person-level notice data.
 */
export const dealRadarScore = task({
  id: 'deal-radar-score',
  // Mirrors ingest-land-data: the CH bulk scan + in-memory cohort model need
  // headroom beyond the default small-1x worker.
  machine: 'medium-2x',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (
    payload: { tenantId?: string; topN?: number; minConfidence?: number; hpiFactor?: number; capturedAt?: string },
    { ctx }
  ) => {
    const tenantId = payload?.tenantId ?? process.env.RDR_TENANT_ID;
    if (!tenantId) throw new Error('Missing tenantId (payload.tenantId or RDR_TENANT_ID)');

    const topN = payload?.topN ?? (process.env.RDR_TOP_N ? Number(process.env.RDR_TOP_N) : undefined);
    const minConfidence =
      payload?.minConfidence ?? (process.env.RDR_MIN_CONFIDENCE ? Number(process.env.RDR_MIN_CONFIDENCE) : undefined);
    const hpiFactor =
      payload?.hpiFactor ?? (process.env.RDR_HPI_FACTOR ? Number(process.env.RDR_HPI_FACTOR) : undefined);
    const capturedAt = payload?.capturedAt ?? new Date().toISOString();

    logger.info('Deal Radar scoring run starting', { runId: ctx.run.id, tenantId });
    const result = await runDealRadarScore(tenantId, {
      topN,
      minConfidence,
      hpiFactor,
      capturedAt,
      run: ctx.run.id,
      log: (m) => logger.info(m),
    });
    logger.info('Deal Radar scoring run complete', { ...result.stats, ...result.ingest });
    return result;
  },
});
