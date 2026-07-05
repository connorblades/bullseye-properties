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
