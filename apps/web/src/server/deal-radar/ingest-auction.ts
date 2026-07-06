/**
 * Auction Finder live-lens worker (M9).
 *
 * The LIVE half of Deal Radar: surface on-market listings priced below their
 * open-data comparables as `auction` candidates in the daily Deal Review inbox.
 *
 * === AC-16, non-negotiable ===
 * The platform runs NO portal scraping in its own code. This worker only builds
 * the open-data comparable half (streaming Land Registry Price Paid for the
 * patch) and consumes listings from the feed adapter (live-listings.ts) - a
 * licensed feed or an injected fixture. The portal-listing behaviour reaches the
 * platform only through an external service posting to POST /api/leads/ingest, or
 * a licensed feed. There is no crawler here.
 *
 * Two layers, mirroring ingest-stock.ts:
 *  - computeAuctionMatches(...): pure-of-DB. Streams Land Registry (never
 *    buffering the multi-GB files) to build the district+town comp indexes,
 *    pulls listings from the feed adapter, matches, and returns
 *    { stats, candidates }. No auth, no DB - so it can be dry-run against local
 *    data + a fixture feed to check the AC-16 emit.
 *  - runAuctionMatch(tenantId, ...): calls computeAuctionMatches then ingests the
 *    discounted candidates via ingestCandidatesForTenant (dynamically imported so
 *    the pure layer carries no server-action dependency at module load).
 *
 * Core patch first: Land Registry is filtered to RDR_AUCTION_LR_DISTRICTS
 * (default Bassetlaw + Rotherham, same patch as the historic lens). All comps are
 * open data (OGL); no person-level sources.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseCsvLine } from '@/server/public-data/land-ownership';
import { RDR_LR_DISTRICTS } from './ingest-stock';
import {
  buildCompIndex,
  matchListing,
  listingToCandidate,
  canonicalTown,
  postcodeDistrict,
  type AuctionComp,
  type AuctionListing,
  type CompIndex,
} from './auction-match';
import { fetchLiveListings, type RawFeedListing } from './live-listings';
import type { PropertyType } from './score';
import type { ScrapedCandidate } from '@/lib/lead-intake';

// ── Config ───────────────────────────────────────────────────────────────────

/** Land Registry districts defining the patch (matched on the LR district column). */
export const RDR_AUCTION_LR_DISTRICTS = (process.env.RDR_AUCTION_LR_DISTRICTS ?? RDR_LR_DISTRICTS.join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const DEFAULT_DATA_DIR =
  process.env.RDR_DATA_DIR ?? '/Users/connorblades32/Documents/Companies/Bullseye Properties/data/Open Source Data';

export type AuctionScoreOptions = {
  dataDir?: string;
  /** LR district names defining the patch. Defaults to RDR_AUCTION_LR_DISTRICTS. */
  lrDistricts?: string[];
  /** Scalar HPI adjustment applied to the comp median (default 1). */
  hpiFactor?: number;
  /** Discount threshold 0..1 (default 0.85 = flag at 15%+ below median). */
  threshold?: number;
  /** Inject listings directly (dry-runs / fixture-run), bypassing the HTTP feed. */
  fixtureListings?: RawFeedListing[];
  /** Override the licensed feed URL (else RDR_AUCTION_FEED_URL). */
  feedUrl?: string;
  /** Run identifier baked into each candidate's sourceRef. */
  run?: string;
  /** Capture timestamp (ISO) stamped on each candidate. */
  capturedAt?: string;
  /** Progress sink. */
  log?: (m: string) => void;
};

export type AuctionScoreStats = {
  comps: number;
  districtKeys: number;
  townKeys: number;
  listings: number;
  matched: number;
  discounted: number;
  emitted: number;
};

export type AuctionScoreResult = {
  stats: AuctionScoreStats;
  candidates: ScrapedCandidate[];
};

// ── Local-file streaming (mirrors ingest-stock.ts's streamCsv; shared parseCsvLine) ──

/** Stream a local CSV row-by-row (never buffering the whole file). */
async function* streamCsv(path: string): AsyncGenerator<string[]> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield parseCsvLine(line);
  }
}

const upperTrim = (s: string | undefined) => (s ?? '').trim().toUpperCase();

// ── Land Registry Price Paid columns (no header, positional; same as ingest-stock) ──
const LR = { price: 1, xferDate: 2, postcode: 3, ptype: 4, street: 9, town: 11, district: 12, ppdCat: 14 } as const;
const RESI_TYPES = new Set<PropertyType>(['D', 'S', 'T', 'F']);

// ── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Stream the patch's Land Registry sales into comparable indexes, pull the live
 * listings from the feed adapter, and match each listing against its cohort.
 * Returns the discounted listings as emit-ready ScrapedCandidates plus stats.
 */
export async function computeAuctionMatches(opts: AuctionScoreOptions = {}): Promise<AuctionScoreResult> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const lrDistricts = new Set((opts.lrDistricts ?? RDR_AUCTION_LR_DISTRICTS).map((d) => d.toUpperCase()));
  const hpiFactor = opts.hpiFactor ?? 1;
  const threshold = opts.threshold ?? undefined; // matchListing default 0.85
  const run = opts.run ?? 'local';
  const capturedAt = opts.capturedAt ?? '';
  const log = opts.log ?? (() => {});

  // 1. Land Registry: qualifying residential type-A sales in the patch districts,
  //    as comparables keyed by postcode district + town + street + ptype.
  const comps: AuctionComp[] = [];
  for (const year of [2023, 2024, 2025, 2026]) {
    const path = `${dataDir}/Land Reg/pp-${year}.csv`;
    let seen = 0;
    for await (const cols of streamCsv(path)) {
      seen++;
      if (!lrDistricts.has(upperTrim(cols[LR.district]))) continue;
      if (upperTrim(cols[LR.ppdCat]) !== 'A') continue;
      const ptype = upperTrim(cols[LR.ptype]) as PropertyType;
      if (!RESI_TYPES.has(ptype)) continue;
      const price = Number((cols[LR.price] ?? '').replace(/[^0-9]/g, ''));
      if (!Number.isFinite(price) || price < 10000 || price > 2000000) continue;
      const postcode = upperTrim(cols[LR.postcode]);
      const street = upperTrim(cols[LR.street]);
      if (!street) continue;
      comps.push({
        district: postcodeDistrict(postcode),
        town: canonicalTown(cols[LR.town] ?? ''),
        street,
        ptype,
        price,
        date: (cols[LR.xferDate] ?? '').trim().slice(0, 10),
      });
    }
    log(`Land Reg pp-${year}: scanned ${seen}, ${comps.length} patch comps so far`);
  }
  const index: CompIndex = buildCompIndex(comps);
  log(`Comp index: ${comps.length} comps, ${index.byDistrict.size} district keys, ${index.byTown.size} town keys`);

  // 2. Live listings from the feed adapter (fixture or licensed HTTP feed; never a scraper).
  const listings: AuctionListing[] = await fetchLiveListings({
    fixture: opts.fixtureListings,
    feedUrl: opts.feedUrl,
    log,
  });

  // 3. Match each listing; emit the discounted ones as auction candidates.
  const stats: AuctionScoreStats = {
    comps: comps.length,
    districtKeys: index.byDistrict.size,
    townKeys: index.byTown.size,
    listings: listings.length,
    matched: 0,
    discounted: 0,
    emitted: 0,
  };
  const scored: { listing: AuctionListing; candidate: ScrapedCandidate }[] = [];
  for (const listing of listings) {
    const match = matchListing(listing, index, threshold != null ? { threshold } : {});
    if (!match) continue;
    stats.matched++;
    if (!match.discounted) continue;
    stats.discounted++;
    scored.push({ listing, candidate: listingToCandidate(listing, match, { run, capturedAt, hpiFactor }) });
  }

  // Strongest discount first (highest confidence, then deepest median discount).
  scored.sort(
    (a, b) =>
      (b.candidate.radar?.discountConfidence ?? 0) - (a.candidate.radar?.discountConfidence ?? 0) ||
      (b.candidate.radar?.estMarketValue ?? 0) - (a.candidate.radar?.estMarketValue ?? 0)
  );
  const candidates = scored.map((s) => s.candidate);
  stats.emitted = candidates.length;

  log(
    `Auction Finder: ${stats.listings} listings -> ${stats.matched} matched a cohort, ` +
      `${stats.discounted} discounted 15%+ below median; emitting ${stats.emitted}`
  );
  return { stats, candidates };
}

/**
 * Match the live listings and ingest the discounted candidates for a specific
 * tenant. Used by the Trigger.dev task, which has no auth session - hence the
 * explicit tenantId and the additive ingestCandidatesForTenant seam (dynamically
 * imported so the pure computeAuctionMatches layer stays free of server-action deps).
 */
export async function runAuctionMatch(
  tenantId: string,
  opts: AuctionScoreOptions = {}
): Promise<{ stats: AuctionScoreStats; ingest: { inserted: number; skipped: number; errors: number } }> {
  const { stats, candidates } = await computeAuctionMatches(opts);
  const { ingestCandidatesForTenant } = await import('@/server/actions/lead-review');
  const summary = await ingestCandidatesForTenant(tenantId, candidates, {
    capturedFor: opts.capturedAt ? opts.capturedAt.slice(0, 10) : undefined,
  });
  return { stats, ingest: { inserted: summary.inserted, skipped: summary.skipped, errors: summary.errors.length } };
}
