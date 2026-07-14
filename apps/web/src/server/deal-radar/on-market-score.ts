/**
 * In-platform on-market discount scorer (BSE-OPP-P01 M2, AC-05).
 *
 * When an on-market listing reaches the platform WITHOUT a pre-computed discount
 * (a raw Rightmove listing posted to POST /api/leads/ingest, as opposed to the
 * auction feeder that already ran matcher.py off-platform), this runs the same
 * proven Auction Finder matcher (auction-match.ts) in-platform against the
 * patch's Land Registry comparables, so the discount and the comps that prove it
 * are computed here, not trusted from the feeder.
 *
 * It is deliberately thin: it maps a ScrapedCandidate onto the feed-listing shape,
 * reuses normaliseFeedListing + matchListing + auctionConfidence + auctionReasons
 * verbatim (identical maths to the auction lens), and returns the radar block plus
 * the DiscountEvidence (median, comp count, and a capped sample of the comps
 * themselves) to attach to the stored candidate. No IO, no DB - the comp index is
 * built once per batch by the caller (buildPatchCompIndex) and passed in.
 */

import type { CandidateRadar, DiscountComp, DiscountEvidence, ScrapedCandidate } from '@/lib/lead-intake';
import {
  matchListing,
  auctionConfidence,
  auctionReasons,
  AUCTION_DISCOUNT_THRESHOLD,
  type CompIndex,
} from './auction-match';
import { normaliseFeedListing } from './live-listings';
import { propertyTypeLabel, round5k } from './score';

/** Cap on the comps sampled into the evidence block (storage + card readability). */
export const ONMARKET_MAX_EVIDENCE_COMPS = 8;

export type OnMarketScore = {
  radar: CandidateRadar;
  discountEvidence: DiscountEvidence;
};

export type OnMarketScoreOptions = {
  /** Discount threshold 0..1 (default 0.85 = flag at 15%+ below the comp median). */
  threshold?: number;
  /** Scalar HPI adjustment applied to the comp median (default 1). */
  hpiFactor?: number;
};

/**
 * Score one on-market candidate against the comp index. Returns the radar +
 * evidence when the listing joins a cohort AND is discounted past the threshold;
 * null when it has no usable price/type, no cohort, or is not discounted (in which
 * case the caller leaves the candidate un-enriched - it is still ingested).
 */
export function scoreOnMarketCandidate(
  c: ScrapedCandidate,
  index: CompIndex,
  opts: OnMarketScoreOptions = {}
): OnMarketScore | null {
  const listing = normaliseFeedListing({
    address: c.address,
    postcode: c.postcode,
    propertyType: c.propertyType,
    bedrooms: c.bedrooms,
    guidePrice: c.guidePrice,
    askingPrice: c.askingPrice,
    listingUrl: c.listingUrl,
    sourceRef: c.sourceRef,
  });
  if (!listing) return null;

  const threshold = opts.threshold;
  const match = matchListing(listing, index, threshold != null ? { threshold } : {});
  if (!match || !match.discounted) return null;

  const hpiFactor = opts.hpiFactor ?? 1;
  const radar: CandidateRadar = {
    discountConfidence: auctionConfidence(match),
    discountReasons: auctionReasons(listing, match),
    estMarketValue: round5k(match.medianComp * hpiFactor),
    estAchievable: round5k(match.price),
  };

  const comps: DiscountComp[] = match.likeComps
    .slice()
    .sort((a, b) => a.price - b.price)
    .slice(0, ONMARKET_MAX_EVIDENCE_COMPS)
    .map((k) => ({
      street: k.street,
      town: k.town,
      ptype: propertyTypeLabel(k.ptype),
      price: k.price,
      date: k.date,
    }));

  const discountEvidence: DiscountEvidence = {
    medianComp: match.medianComp,
    compCount: match.compCount,
    matchBasis: match.matchBasis,
    bucketLabel: match.bucketLabel,
    discountVsMedian: match.discountVsMedian,
    threshold: threshold ?? AUCTION_DISCOUNT_THRESHOLD,
    comps,
  };

  return { radar, discountEvidence };
}

/**
 * True when a candidate should be scored in-platform: it is on-market and does
 * NOT already carry a discount signal (the auction feeder / matcher.py already
 * scored it off-platform, so re-scoring would be wasted work and could disagree
 * with the feeder's own comps). `market` is the resolved tag from the caller.
 */
export function needsOnMarketScore(c: ScrapedCandidate, market: 'on-market' | 'off-market'): boolean {
  if (market !== 'on-market') return false;
  const conf = c.radar?.discountConfidence;
  return !(typeof conf === 'number' && Number.isFinite(conf));
}
