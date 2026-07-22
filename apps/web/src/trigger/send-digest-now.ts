import { task, logger } from '@trigger.dev/sdk';
import {
  sendDailyDigestForTenant,
  listActiveTenantIds,
  type DigestSendResult,
} from '@/server/lead-digest/send';

/**
 * send-digest-now (BSE-PLAT-P3 M1, AC-1.1): fire ONE review digest on demand, for
 * verifying delivery the moment RESEND_API_KEY is set - without waiting for the
 * 07:00 UTC `daily-review-digest` cron, and without fanning out to every active
 * tenant's real partner inbox.
 *
 * It reuses the exact same pure ranking + template + Resend path as the scheduled
 * digest (server/lead-digest/send), so a successful run here proves the scheduled
 * one will deliver too.
 *
 * Payload (all optional):
 *   - tenantId  the tenant to build the digest for; else RDR_DIGEST_TENANT_ID; else
 *               the first active tenant (single-tenant setups need pass nothing).
 *   - to        override the recipient (e.g. your own inbox) so a verification send
 *               never reaches a real partner; else the tenant's resolved recipient.
 *   - topN      leads listed (else RDR_DIGEST_TOP_N, else 8).
 *
 * Requires RESEND_API_KEY (+ a verified sender domain) exactly as the scheduled task
 * does; without it the send throws (surfaced in the run, not swallowed).
 */
export const sendDigestNow = task({
  id: 'send-digest-now',
  maxDuration: 120,
  run: async (payload: { tenantId?: string; to?: string; topN?: number }): Promise<DigestSendResult> => {
    const tenantId =
      payload.tenantId?.trim() ||
      process.env.RDR_DIGEST_TENANT_ID?.trim() ||
      (await listActiveTenantIds())[0];

    if (!tenantId) {
      throw new Error('No tenant to send a digest for (no payload.tenantId, no RDR_DIGEST_TENANT_ID, no active tenant).');
    }

    const to = payload.to?.trim() || undefined;
    logger.info('On-demand digest starting', { tenantId, hasOverrideRecipient: !!to });

    const result = await sendDailyDigestForTenant(tenantId, { to, topN: payload.topN });
    logger.info('On-demand digest complete', { ...result });
    return result;
  },
});
