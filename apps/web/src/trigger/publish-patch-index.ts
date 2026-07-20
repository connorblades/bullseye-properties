import { task, logger } from '@trigger.dev/sdk';
import { buildPatchCompIndex } from '@/server/deal-radar/ingest-auction';
import { buildPatchPropensityIndex } from '@/server/deal-radar/ingest-stock';
import { serializePatchIndex } from '@/server/deal-radar/patch-index-serialization';
import { uploadPatchIndexArtifact } from '@/server/deal-radar/patch-index-store';

/**
 * publish-patch-index (BSE-OPP-P01 M5): build the Deal Radar patch index from the
 * local ~4.7GB open-data files and publish the DERIVED slice (gzipped JSON, tens of
 * MB) to the private `patch-index` Supabase bucket, so the cloud on-market discount
 * / off-market negotiability scorers can enrich listings without hosting the raw
 * data.
 *
 * Run LOCALLY on the machine that holds RDR_DATA_DIR (Connor's Mac), the same way
 * deal-radar-score is run (streams the multi-GB files, never buffering them). Connor
 * runs it on each data refresh (~monthly). No cloud rebuild is ever required.
 *
 * GDPR: person-level fields (pscName) are dropped from the artifact by default. They
 * are retained ONLY if `payload.includePersonLevel` is set AND the person-level env
 * gates that populate them are deliberately on (see deal-radar-score.ts) - do not do
 * this without a documented UK GDPR lawful-basis review.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (upload), RDR_DATA_DIR,
 * RDR_LR_DISTRICTS, RDR_AUCTION_LR_DISTRICTS, and the same M10 signal env as
 * deal-radar-score (all off by default).
 */
export const publishPatchIndex = task({
  id: 'publish-patch-index',
  // Same headroom as deal-radar-score: the CH bulk scan + in-memory indexes need
  // more than the default small-1x worker.
  machine: 'medium-2x',
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (
    payload: { version?: string; capturedAt?: string; includePersonLevel?: boolean },
    { ctx }
  ) => {
    const capturedAt = payload?.capturedAt ?? new Date().toISOString();
    const version = payload?.version ?? capturedAt.slice(0, 10); // e.g. "2026-07-20"
    const includePersonLevel = payload?.includePersonLevel ?? false;

    logger.info('Patch-index publish starting', { runId: ctx.run.id, version, includePersonLevel });

    // Build both indexes from the local streams (reusing the exact builders the
    // scorers use - no re-implementation of streaming or scoring).
    const { index: comp, comps } = await buildPatchCompIndex({ log: (m) => logger.info(m) });
    const propensity = await buildPatchPropensityIndex({ capturedAt, log: (m) => logger.info(m) });

    const serialized = serializePatchIndex(comp, propensity, { version, builtAt: capturedAt, includePersonLevel });
    const result = await uploadPatchIndexArtifact(serialized);

    logger.info('Patch-index publish complete', {
      ...result,
      comps,
      dwellings: propensity.dwellingByJoin.size,
      ownerDoors: propensity.tables.ownerSignalsByKey.size,
    });
    return result;
  },
});
