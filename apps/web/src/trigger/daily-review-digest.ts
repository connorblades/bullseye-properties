import { schedules, logger } from '@trigger.dev/sdk';
import {
  sendDailyDigestForTenant,
  listActiveTenantIds,
  type DigestSendResult,
} from '@/server/lead-digest/send';

type DigestRunResult = DigestSendResult | { tenantId: string; outcome: 'error'; reason: string };

/**
 * daily-review-digest (BSE-OPP-P01 M4, AC-07): email each partner a ranked summary
 * of their top pending review leads so the morning triage starts from the strongest
 * matches.
 *
 * Cloud-safe: it reads only the already-ingested lead_candidates and the partner
 * profile (no local data files), so unlike deal-radar-score it runs fine on a hosted
 * worker. It re-uses the M4 combined ranking (lib/lead-rank) and the pure digest
 * template (lib/lead-digest); this task only fans out per tenant and sends.
 *
 * Recipient per tenant: the partner_profiles.contactEmail, or the DIGEST_TO env
 * fallback. A tenant with an empty inbox or no resolvable recipient is skipped (no
 * email). Fail-soft: one tenant's send error is logged and does not abort the run.
 *
 * Requires RESEND_API_KEY (+ a verified SHARE_EMAIL_FROM / default sender domain) to
 * actually deliver; without it the send throws and is caught per tenant.
 *
 * Env:
 *   - RDR_DIGEST_TENANT_ID   restrict the run to one tenant (else all active tenants)
 *   - RDR_DIGEST_TOP_N       leads listed per digest (default 8)
 *   - DIGEST_TO              recipient fallback when a tenant has no partner email
 *   - NEXT_PUBLIC_SITE_URL   base URL for the /review link
 */
export const dailyReviewDigest = schedules.task({
  id: 'daily-review-digest',
  // 07:00 UTC every day - before the working morning. Adjust in the Trigger dashboard
  // or here; the schedule is declarative.
  cron: '0 7 * * *',
  maxDuration: 300,
  run: async (payload, { ctx }) => {
    const only = process.env.RDR_DIGEST_TENANT_ID?.trim();
    const tenantIds = only ? [only] : await listActiveTenantIds();

    logger.info('Daily review digest starting', {
      runId: ctx.run.id,
      scheduledAt: payload.timestamp,
      tenants: tenantIds.length,
    });

    const results: DigestRunResult[] = [];
    for (const tenantId of tenantIds) {
      try {
        const r = await sendDailyDigestForTenant(tenantId);
        results.push(r);
        logger.info('Digest processed', { ...r });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        logger.error('Digest failed for tenant', { tenantId, reason });
        results.push({ tenantId, outcome: 'error', reason });
      }
    }

    const sent = results.filter((r) => r.outcome === 'sent').length;
    logger.info('Daily review digest complete', { tenants: tenantIds.length, sent });
    return { tenants: tenantIds.length, sent, results };
  },
});
