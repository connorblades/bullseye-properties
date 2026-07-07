import { describe, expect, it } from 'vitest';
import { computeStockScores } from '@/server/deal-radar/ingest-stock';
import { buildAreaWeightTable } from '@/server/deal-radar/area-weights';
import type { GazetteInsolvencyEvent } from '@/server/deal-radar/distress-sources';

/**
 * AC-17 runtime dry-run against the real local core-patch data. Heavy (streams
 * ~4.7GB, ~90s), so it is SKIPPED unless RDR_DRYRUN=1 is set. Run it locally with:
 *
 *   RDR_DRYRUN=1 RDR_DATA_DIR="/abs/path/to/Open Source Data" \
 *     pnpm vitest run tests/unit/deal-radar-distress-dryrun.spec.ts
 *
 * It proves the two non-negotiable AC-17 clauses on live data:
 *  1. Force every M10 fetcher to fail -> the core-patch run still completes and
 *     still emits candidates (fail-soft; a source outage never breaks a run).
 *  2. Injecting the empty-homes area weight (and a Gazette district notice)
 *     changes the area score: hotspot dwellings are flagged and lifted.
 */
describe.runIf(process.env.RDR_DRYRUN === '1')('AC-17 core-patch dry-run', () => {
  const capturedAt = '2026-07-07T00:00:00.000Z';

  it(
    'completes and emits with every distress fetcher forced to fail (fail-soft)',
    async () => {
      const result = await computeStockScores({
        capturedAt,
        run: 'ac17-forcefail',
        topN: 200,
        // Force the PSC lookup to throw on every call; failSoft must swallow it.
        pscLookup: async () => {
          throw new Error('forced PSC outage');
        },
        // Force the Gazette source to "fail": inject an empty event set as if the
        // fetch returned nothing. (The unit suite covers a throwing transport.)
        gazetteEvents: [],
        // Force the area-weight source to fail: an empty table (neutral).
        areaWeights: new Map(),
        log: (m) => console.log(m),
      });
      // The run completed and still produced candidates despite the outages.
      expect(result.stats.dwellingsScored).toBeGreaterThan(50_000);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.stats.emitted).toBe(result.candidates.length);
    },
    300_000
  );

  it(
    'the empty-homes area weight changes the area score on real dwellings',
    async () => {
      // Rotherham marked a heavy empty-homes hotspot; Bassetlaw at the median.
      const areaWeights = buildAreaWeightTable([
        { localAuthority: 'Bassetlaw', dwellings: 60_000, longTermEmpty: 600, premiumCharged: 200 },
        { localAuthority: 'Rotherham', dwellings: 100_000, longTermEmpty: 3_000, premiumCharged: 1_500 },
      ]);
      // Also exercise the Gazette join path with an exact-postcode notice (kept
      // narrow so it can never over-fire across a whole district).
      const gazetteEvents: GazetteInsolvencyEvent[] = [
        { noticeType: 'winding-up', noticePostcode: 'S80 1AA', publishedDate: '2026-06-25', daysSinceEvent: 12 },
      ];

      const withWeights = await computeStockScores({
        capturedAt,
        run: 'ac17-weighted',
        topN: 500,
        areaWeights,
        gazetteEvents,
        log: (m) => console.log(m),
      });
      const neutral = await computeStockScores({
        capturedAt,
        run: 'ac17-neutral',
        topN: 500,
        areaWeights: new Map(),
        gazetteEvents: [],
        log: (m) => console.log(m),
      });

      // AC-17: the empty-homes weight flags hotspot dwellings and lifts the score.
      expect(withWeights.stats.areaHotspotDwellings).toBeGreaterThan(0);
      expect(neutral.stats.areaHotspotDwellings).toBe(0);
      // Lifting Rotherham's cohort base rate pushes more dwellings over the 60% line.
      expect(withWeights.stats.conf60).toBeGreaterThan(neutral.stats.conf60);
      // At least one emitted candidate now carries the empty-homes area reason.
      const hasAreaReason = withWeights.candidates.some((c) =>
        (c.radar?.discountReasons ?? []).includes('empty-homes hotspot LA')
      );
      expect(hasAreaReason).toBe(true);
    },
    600_000
  );
});
