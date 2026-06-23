import { task, logger } from '@trigger.dev/sdk';
import { ingestDataset } from '@/server/public-data/land-ownership';

/**
 * ingest-land-data: refresh the land_ownership table from HMLR's free monthly
 * CCOD/OCOD datasets (corporate owners), filtered to Bullseye's operating
 * postcode areas. Long-running (streams + parses the national CSV); run monthly
 * via schedule or on demand. Needs HMLR_API_KEY.
 */
export const ingestLandData = task({
  id: 'ingest-land-data',
  // CCOD full file (~1.5GB zip) OOM-kills the default small-1x worker; the
  // stream is bounded but PostGIS batches + decompression need more headroom.
  machine: 'medium-2x',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: { datasets?: ('ccod' | 'ocod')[] }, { ctx }) => {
    const datasets = payload?.datasets ?? (['ccod', 'ocod'] as const);
    const results = [];
    for (const d of datasets) {
      logger.info(`Ingesting ${d}`, { runId: ctx.run.id });
      results.push(await ingestDataset(d, (m) => logger.info(m)));
    }
    return { results };
  },
});
