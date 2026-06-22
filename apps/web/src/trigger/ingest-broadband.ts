import { task, logger } from '@trigger.dev/sdk/v3';
import { ingestBroadband } from '@/server/public-data/broadband';

/**
 * ingest-broadband: refresh broadband_coverage from an Ofcom Connected Nations
 * fixed-broadband postcode CSV, filtered to Bullseye's operating areas. Source
 * URL from the payload or OFCOM_BROADBAND_CSV_URL. Long-running; run on each
 * Ofcom release. No stable Ofcom API, so the CSV URL must be supplied.
 */
export const ingestBroadbandData = task({
  id: 'ingest-broadband',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: { csvUrl?: string }, { ctx }) => {
    logger.info('Ingesting Ofcom broadband', { runId: ctx.run.id });
    const stats = await ingestBroadband(payload?.csvUrl, (m) => logger.info(m));
    return stats;
  },
});
