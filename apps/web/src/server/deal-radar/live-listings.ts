/**
 * Auction Finder live-listings feed adapter (M9).
 *
 * === AC-16, non-negotiable ===
 * This module is a feed CLIENT ONLY. It NEVER scrapes Rightmove, Zoopla or any
 * property portal. On-market listing behaviour reaches the platform through
 * exactly two legitimate doors, both external to this code:
 *   1. an external service / licensed data feed that POSTs to the token-guarded
 *      POST /api/leads/ingest endpoint (M7), or
 *   2. a licensed listings feed whose HTTP URL is read here, behind an env gate.
 * There is no HTML parsing, no portal URL, no crawler. A source scan for a portal
 * scraper in platform code must come back empty.
 *
 * Two sources, both fail-soft:
 *   - a fixture source (deterministic listings) for tests and dry-runs;
 *   - a licensed-feed HTTP client behind RDR_AUCTION_FEED_URL (optionally
 *     Bearer-authenticated via RDR_AUCTION_FEED_TOKEN), consumed with the shared
 *     fail-soft fetch helper. If the URL is unset or the fetch fails, it returns
 *     an empty list - never throws, never a 500.
 *
 * The adapter's job is to hand ingest-auction.ts already-normalised
 * AuctionListings (district/town/street/ptype resolved via the auction-match
 * helpers), so the pure matcher stays free of feed-parsing concerns.
 */

import { failSoft, fetchJson } from '@/server/public-data/http';
import { canonicalTown, normaliseTown, postcodeDistrict, type AuctionListing } from './auction-match';
import type { PropertyType } from './score';

/** Licensed-feed endpoint (unset by default; no source => no listings, never a scraper). */
const FEED_URL = process.env.RDR_AUCTION_FEED_URL;
/** Optional bearer token for the licensed feed. */
const FEED_TOKEN = process.env.RDR_AUCTION_FEED_TOKEN;

/**
 * The raw listing shape a licensed feed / the external ingest service produces.
 * Everything except a price and enough to locate the property is best-effort.
 */
export type RawFeedListing = {
  address?: string;
  postcode?: string;
  town?: string;
  street?: string;
  propertyType?: string;
  bedrooms?: number;
  guidePrice?: number;
  askingPrice?: number;
  listingUrl?: string;
  sourceRef?: string;
};

export type LiveListingsOptions = {
  /** Inject listings directly (tests / dry-runs). Bypasses the HTTP client entirely. */
  fixture?: RawFeedListing[];
  /** Override the feed URL (else RDR_AUCTION_FEED_URL). */
  feedUrl?: string;
  log?: (m: string) => void;
};

/**
 * Map a feed's free-text property type to a Land Registry ptype code, or null
 * when it maps to none. Flats/maisonettes/apartments are 'F'; a "semi" wins over
 * a bare "detached" substring.
 */
export function feedPropertyType(text: string | undefined): PropertyType | null {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 'F';
  if (t.includes('terrace')) return 'T';
  if (t.includes('semi')) return 'S';
  if (t.includes('detached')) return 'D';
  return null;
}

/** Leading street name from an address ("12 Church Street, Swinton" -> "Church Street"). */
function streetFromAddress(address: string): string {
  const first = address.split(',')[0]?.trim() ?? '';
  return first.replace(/^\d+[A-Za-z]?\s*/, '').trim();
}

/**
 * Normalise a raw feed listing into an AuctionListing, resolving district (from
 * the postcode), town (explicit, else parsed from the address), street (explicit,
 * else parsed) and ptype. Returns null when it lacks an address, a usable price,
 * or a mappable property type - so it can never enter matching half-formed.
 */
export function normaliseFeedListing(raw: RawFeedListing): AuctionListing | null {
  const address = (raw.address ?? '').trim();
  if (!address) return null;
  const guidePrice = typeof raw.guidePrice === 'number' && raw.guidePrice > 0 ? raw.guidePrice : undefined;
  const askingPrice = typeof raw.askingPrice === 'number' && raw.askingPrice > 0 ? raw.askingPrice : undefined;
  if (guidePrice === undefined && askingPrice === undefined) return null;
  const ptype = feedPropertyType(raw.propertyType);
  if (!ptype) return null;

  const postcode = (raw.postcode ?? '').trim().toUpperCase();
  const street = (raw.street ?? '').trim() || streetFromAddress(address);
  if (!street) return null;
  const town = (raw.town ?? '').trim() ? canonicalTown(raw.town!) : normaliseTown(address);

  return {
    address,
    postcode,
    district: postcodeDistrict(postcode),
    town,
    street,
    ptype,
    guidePrice,
    askingPrice,
    bedrooms: typeof raw.bedrooms === 'number' && raw.bedrooms >= 0 ? raw.bedrooms : undefined,
    listingUrl: (raw.listingUrl ?? '').trim() || undefined,
    sourceRef: (raw.sourceRef ?? '').trim() || undefined,
  };
}

/**
 * Pull live listings from the configured source and normalise them. Fixture
 * takes precedence (tests/dry-runs); otherwise the licensed HTTP feed is called
 * fail-soft. No feed configured => empty list. Never scrapes a portal, never
 * throws.
 */
export async function fetchLiveListings(opts: LiveListingsOptions = {}): Promise<AuctionListing[]> {
  const log = opts.log ?? (() => {});

  if (opts.fixture) {
    const listings = opts.fixture.map(normaliseFeedListing).filter((l): l is AuctionListing => l !== null);
    log(`Live listings: ${listings.length} from injected fixture (${opts.fixture.length} raw)`);
    return listings;
  }

  const url = opts.feedUrl ?? FEED_URL;
  if (!url) {
    log('Live listings: no RDR_AUCTION_FEED_URL configured; the portal half is external (POST /api/leads/ingest).');
    return [];
  }

  const raw = await failSoft('auction-finder feed', () =>
    fetchJson<RawFeedListing[]>(url, {
      headers: FEED_TOKEN ? { authorization: `Bearer ${FEED_TOKEN}` } : undefined,
    })
  );
  if (!raw || !Array.isArray(raw)) {
    log('Live listings: licensed feed unavailable or malformed; returning none (fail-soft).');
    return [];
  }
  const listings = raw.map(normaliseFeedListing).filter((l): l is AuctionListing => l !== null);
  log(`Live listings: ${listings.length} usable from the licensed feed (${raw.length} raw).`);
  return listings;
}

/**
 * A small deterministic fixture feed for dry-runs and the AC-16 fixture-run. These
 * are fabricated listings (NOT scraped) exercising a district match, a town-only
 * match, and a non-discounted control, so a fixture-run demonstrably emits
 * auction candidates end-to-end.
 */
export const FIXTURE_LISTINGS: RawFeedListing[] = [
  {
    // District match, clearly discounted (guide 20% below the comp median).
    address: '14 Church Street, Swinton, S64 8QA',
    postcode: 'S64 8QA',
    street: 'Church Street',
    propertyType: 'Terraced house',
    bedrooms: 2,
    guidePrice: 96000,
    listingUrl: 'https://feed.example/lot/14-church-street-s64',
    sourceRef: 'fixture-lot-1',
  },
  {
    // Town-only match (no postcode district in the feed row), discounted.
    address: '5 Newcastle Street, Worksop',
    town: 'worksop',
    street: 'Newcastle Street',
    propertyType: 'Semi-detached house',
    bedrooms: 3,
    guidePrice: 110000,
    listingUrl: 'https://feed.example/lot/5-newcastle-street-worksop',
    sourceRef: 'fixture-lot-2',
  },
  {
    // Control: priced ABOVE the comp median, so it must NOT emit.
    address: '9 Church Street, Swinton, S64 8QA',
    postcode: 'S64 8QA',
    street: 'Church Street',
    propertyType: 'Terraced house',
    bedrooms: 2,
    askingPrice: 145000,
    listingUrl: 'https://feed.example/lot/9-church-street-s64',
    sourceRef: 'fixture-lot-3',
  },
];
