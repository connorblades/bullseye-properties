import { task, logger } from '@trigger.dev/sdk';
import { ingestMobileCoverage } from '@/server/public-data/mobile-coverage';

/**
 * ingest-mobile-coverage: refresh mobile_coverage from an Ofcom Connected Nations
 * mobile CSV (aggregated at local-authority level). Source URL from the payload or
 * OFCOM_MOBILE_CSV_URL - point it at the extracted `..._laua_r01.csv` member. No
 * stable Ofcom API, so the CSV URL must be supplied. Run on each Ofcom release.
 */
export const ingestMobileCoverageData = task({
  id: 'ingest-mobile-coverage',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: { csvUrl?: string }, { ctx }) => {
    logger.info('Ingesting Ofcom mobile coverage', { runId: ctx.run.id });
    const stats = await ingestMobileCoverage(payload?.csvUrl, (m) => logger.info(m));
    return stats;
  },
});
