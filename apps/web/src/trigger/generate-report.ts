import { task, logger } from '@trigger.dev/sdk/v3';
import { generateAndStoreReport } from '@/server/pdf/generate-report';

/**
 * generate-report (M3-T10).
 *
 * Renders a deal report version to PDF and stores it in the deal-packs bucket.
 * The Claude narrative generation happens interactively in the wizard (Stage
 * 14) and is persisted to the deal before this runs; this task is the render +
 * upload step. publishReport invokes the same core inline for the synchronous
 * path; this task exists for async / retry-backed renders.
 */
export const generateReport = task({
  id: 'generate-report',
  maxDuration: 180,
  retry: { maxAttempts: 2 },
  run: async (payload: { tenantId: string; dealId: string; versionId: string; version: number }, { ctx }) => {
    logger.info('generate-report invoked', { runId: ctx.run.id, payload });
    const result = await generateAndStoreReport(payload);
    logger.info('generate-report complete', { runId: ctx.run.id, ...result });
    return result;
  },
});
