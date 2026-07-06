import { task, logger } from '@trigger.dev/sdk';
import { runAuctionMatch } from '@/server/deal-radar/ingest-auction';

/**
 * ingest-auction: the Auction Finder live lens. Stream the patch's Land Registry
 * comparables, pull on-market listings from the licensed feed adapter (never a
 * portal scraper - AC-16), flag the ones priced 15%+ below their comp median, and
 * emit them as `auction` candidates into the M7 Deal Review inbox.
 *
 * Long-running (streams the multi-GB local Land Registry files, never buffering
 * them). The tenant has no auth session in a Trigger run, so the target tenant is
 * passed explicitly (payload.tenantId or RDR_TENANT_ID) and queued via the
 * additive ingestCandidatesForTenant seam. Env: RDR_DATA_DIR,
 * RDR_AUCTION_LR_DISTRICTS, RDR_AUCTION_FEED_URL, RDR_AUCTION_FEED_TOKEN,
 * RDR_AUCTION_THRESHOLD, RDR_HPI_FACTOR, RDR_TENANT_ID.
 */
export const ingestAuction = task({
  id: 'ingest-auction',
  // Mirrors deal-radar-score: the Land Registry stream + in-memory comp index
  // need headroom beyond the default small-1x worker.
  machine: 'medium-2x',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (
    payload: { tenantId?: string; threshold?: number; hpiFactor?: number; capturedAt?: string },
    { ctx }
  ) => {
    const tenantId = payload?.tenantId ?? process.env.RDR_TENANT_ID;
    if (!tenantId) throw new Error('Missing tenantId (payload.tenantId or RDR_TENANT_ID)');

    const threshold =
      payload?.threshold ?? (process.env.RDR_AUCTION_THRESHOLD ? Number(process.env.RDR_AUCTION_THRESHOLD) : undefined);
    const hpiFactor =
      payload?.hpiFactor ?? (process.env.RDR_HPI_FACTOR ? Number(process.env.RDR_HPI_FACTOR) : undefined);
    const capturedAt = payload?.capturedAt ?? new Date().toISOString();

    logger.info('Auction Finder run starting', { runId: ctx.run.id, tenantId });
    const result = await runAuctionMatch(tenantId, {
      threshold,
      hpiFactor,
      capturedAt,
      run: ctx.run.id,
      log: (m) => logger.info(m),
    });
    logger.info('Auction Finder run complete', { ...result.stats, ...result.ingest });
    return result;
  },
});
