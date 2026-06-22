import { task, logger } from '@trigger.dev/sdk/v3';
import { ingestInspire } from '@/server/public-data/boundaries';

/**
 * ingest-boundaries: refresh land_boundary from HMLR's free INSPIRE Index
 * Polygons (per local authority), filtered to HMLR_INSPIRE_LAS. Long-running;
 * run on each INSPIRE release. Needs PostGIS enabled + HMLR_API_KEY.
 */
export const ingestBoundaries = task({
  id: 'ingest-boundaries',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (_payload: Record<string, never>, { ctx }) => {
    logger.info('Ingesting INSPIRE boundaries', { runId: ctx.run.id });
    const stats = await ingestInspire((m) => logger.info(m));
    return stats;
  },
});
