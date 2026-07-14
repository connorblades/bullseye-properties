/**
 * Auction Finder comp matcher (M9, pure core).
 *
 * A faithful TypeScript port of the proven Auction Finder proof engine
 * (auction-finder/matcher.py, find_opportunities). No IO, no DB, no server
 * imports - it takes already-parsed typed comps and listings and returns the
 * ones priced below their like-for-like comparable median, so it is
 * unit-testable in isolation and reusable by the streaming worker
 * (ingest-auction.ts).
 *
 * This is the LIVE lens of Deal Radar. Where the historic lens (score.ts) scores
 * the SITUATION (would this owner concede?), the Auction Finder scores the PRICE
 * (is this on-market listing cheap versus what its cohort actually sold for?).
 * It is a price-discount signal, not a seller-motivation score.
 *
 * Matching priority, ported verbatim from matcher.py:
 *   1. Postcode district + street + property type  (most precise)
 *   2. Town name + street + property type          (covers listings with no postcode)
 * then a like-for-like price band (40%..160% of the listing price) removes
 * outliers (Land Registry has no bedroom data, so an extended 4-bed on the same
 * street as 2-beds is filtered by price), and a listing is flagged discounted
 * when its guide/asking is at least 15% below the like-for-like comparable median.
 *
 * The one deliberate divergence from the proof (mirroring score.ts, per AC-16):
 * estMarketValue is the comp median HPI-adjusted (a scalar factor, seam for the
 * local HPI series) and rounded to the nearest GBP 5,000, reusing round5k. The
 * comp-matching maths and the 15%-below-median threshold are unchanged from the
 * proof.
 */

import type { ScrapedCandidate } from '@/lib/lead-intake';
import { median, round5k, propertyTypeLabel, type PropertyType } from './score';

/** Threshold: a listing is flagged when its price is <= 85% of the comp median (15%+ below). */
export const AUCTION_DISCOUNT_THRESHOLD = 0.85;
/** Like-for-like price band around the listing price (ported from matcher.py). */
const LIKE_BAND_LO = 0.4;
const LIKE_BAND_HI = 1.6;
/** Minimum like-for-like comps before the band is trusted; else fall back to all comps. */
const MIN_LIKE_COMPS = 2;
/** Sanity cap on a comp's sold price (the patch is sub-300k stock; ported from matcher.py). */
const DEFAULT_MAX_COMP_PRICE = 300_000;
/** Comps needed for a fully-reliable median; fewer linearly discounts confidence. */
const AUCTION_RELIABLE_COMPS = 8;

/**
 * One Land Registry sale used as a comparable. `district` is the postcode
 * district (e.g. "S64"); `town` is the Land Registry town/city, both already
 * normalised by the caller. `date` (ISO-ish "YYYY-MM-DD") only orders the
 * comparables list.
 */
export type AuctionComp = {
  district: string;
  town: string;
  street: string;
  ptype: PropertyType;
  price: number;
  date: string;
};

/**
 * An on-market listing to price-check. It reaches the platform ONLY through the
 * feed adapter (live-listings.ts) or the token-guarded POST /api/leads/ingest -
 * never a portal scraper (AC-16). `district`/`town`/`street` are normalised by
 * the caller so this module stays pure. `guidePrice` (auction) is preferred over
 * `askingPrice` (private treaty) for the discount test.
 */
export type AuctionListing = {
  address: string;
  postcode: string;
  district: string;
  town: string;
  street: string;
  ptype: PropertyType;
  guidePrice?: number;
  askingPrice?: number;
  bedrooms?: number;
  listingUrl?: string;
  sourceRef?: string;
};

/**
 * The comparable indexes. Keys are `${bucket}|${street}|${ptype}` lower-cased,
 * exactly as matcher.py's _match_key, so a listing joins its cohort in O(1).
 */
export type CompIndex = {
  byDistrict: Map<string, AuctionComp[]>;
  byTown: Map<string, AuctionComp[]>;
};

/** The price comparison for one listing (discounted flag + the comp stats behind it). */
export type AuctionMatch = {
  /** True when price <= median * AUCTION_DISCOUNT_THRESHOLD (15%+ below). */
  discounted: boolean;
  /** The listing price used (guide preferred over asking). */
  price: number;
  /** Which price fed the test, for the reason wording. */
  priceLabel: 'guide' | 'asking';
  /** Like-for-like comparable median (raw, pre-HPI, pre-rounding). */
  medianComp: number;
  maxComp: number;
  avgComp: number;
  /** Number of like-for-like comps behind the median. */
  compCount: number;
  /** Percent below the median/max/avg (1dp, ported from matcher.py). */
  discountVsMedian: number;
  discountVsMax: number;
  discountVsAvg: number;
  /** How the cohort was found. */
  matchBasis: 'district' | 'town';
  /** The bucket the reason names ("S64" for a district match, the town otherwise). */
  bucketLabel: string;
  /** The like-for-like comps behind the median (the evidence that proves the discount). */
  likeComps: AuctionComp[];
};

/** Options for matchListing (the sanity cap + the HPI seam live on the caller). */
export type MatchOptions = {
  /** Discount threshold override (default 0.85 = 15% below). */
  threshold?: number;
  /** Sanity cap on a comp's sold price (default 300,000). */
  maxCompPrice?: number;
};

// ── Normalisation helpers (ported from matcher.py) ────────────────────────────

/** Town-name aliases: variations map to a canonical patch town (ported from matcher.py). */
export const TOWN_ALIASES: Record<string, string> = {
  worksop: 'worksop',
  retford: 'retford',
  clowne: 'clowne',
  bolsover: 'bolsover',
  creswell: 'creswell',
  shirebrook: 'shirebrook',
  langwith: 'langwith',
  mansfield: 'mansfield',
  harworth: 'harworth',
  dinnington: 'dinnington',
  maltby: 'maltby',
  wales: 'wales',
  kiveton: 'kiveton',
  eckington: 'eckington',
  barlborough: 'barlborough',
  whitwell: 'whitwell',
  warsop: 'warsop',
  edwinstowe: 'edwinstowe',
  ollerton: 'ollerton',
  tuxford: 'tuxford',
  bawtry: 'bawtry',
  tickhill: 'tickhill',
  manton: 'manton',
  staveley: 'staveley',
  chesterfield: 'chesterfield',
  sheffield: 'sheffield',
  rotherham: 'rotherham',
  doncaster: 'doncaster',
  swinton: 'swinton',
  'sutton-in-ashfield': 'sutton-in-ashfield',
  'sutton in ashfield': 'sutton-in-ashfield',
  'kirkby in ashfield': 'kirkby-in-ashfield',
  'kirkby-in-ashfield': 'kirkby-in-ashfield',
  'new ollerton': 'ollerton',
  'forest town': 'mansfield',
  welbeck: 'worksop',
  rhodesia: 'worksop',
  shireoaks: 'worksop',
  'carlton in lindrick': 'carlton-in-lindrick',
  'carlton-in-lindrick': 'carlton-in-lindrick',
};

const COUNTY_SUFFIXES = [
  ' south yorkshire',
  ' north nottinghamshire',
  ' nottinghamshire',
  ' derbyshire',
  ' yorkshire',
  ' nottingham',
];

/** Postcode district: leading letters + digits (e.g. "S64 8QA" -> "S64"). Ported from matcher.py. */
export function postcodeDistrict(postcode: string): string {
  const m = postcode.trim().toUpperCase().match(/^[A-Z]{1,2}\d{1,2}[A-Z]?/);
  return m ? m[0] : '';
}

/**
 * Extract and normalise a town from an address string, ported from matcher.py's
 * _normalise_town: longest alias match wins; else the first non-numeric,
 * non-postcode comma segment after the street, with county suffixes stripped.
 */
export function normaliseTown(text: string): string {
  const lower = text.toLowerCase().trim();
  // Longest alias first so "kirkby in ashfield" beats a bare "ashfield" fragment.
  for (const alias of Object.keys(TOWN_ALIASES).sort((a, b) => b.length - a.length)) {
    if (lower.includes(alias)) return TOWN_ALIASES[alias];
  }
  const parts = lower.split(',').map((p) => p.trim());
  for (const raw of parts.slice(1)) {
    if (!raw || raw.length <= 2) continue;
    if (/^[a-z]{1,2}\d/.test(raw)) continue; // looks like a postcode
    let part = raw;
    for (const suffix of COUNTY_SUFFIXES) part = part.replace(suffix, '');
    part = part.trim();
    if (part) return TOWN_ALIASES[part] ?? part;
  }
  return '';
}

/**
 * Canonicalise a clean town NAME (not an address): lower-case, trim, and apply an
 * alias if one exists, but keep towns outside the alias map. Used for the Land
 * Registry town/city column and for a feed's explicit town, so both sides of the
 * town index agree. Address strings go through normaliseTown instead.
 */
export function canonicalTown(name: string): string {
  const t = name.trim().toLowerCase();
  return TOWN_ALIASES[t] ?? t;
}

/** Compose the index key exactly as matcher.py's _match_key (lower-cased, trimmed). */
function matchKey(bucket: string, street: string, ptype: string): string {
  return `${bucket.toLowerCase().trim()}|${street.toLowerCase().trim()}|${ptype.toLowerCase().trim()}`;
}

/** Whole-pound thousands separator ("£120,000"), deterministic (no locale/ICU dependency). */
function gbp(n: number): string {
  return `£${Math.round(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Percent below a reference, to 1dp (ported from matcher.py's round(..., 1)). */
function discountPct(price: number, ref: number): number {
  return Math.round((1 - price / ref) * 1000) / 10;
}

// ── Index + match ─────────────────────────────────────────────────────────────

/**
 * Build the district-then-town comparable indexes from Land Registry comps, keyed
 * by `${bucket}|${street}|${ptype}`. Every comp is indexed by both its postcode
 * district and its town, so a listing can join on either. Ported from the index
 * build in matcher.py.
 */
export function buildCompIndex(comps: AuctionComp[]): CompIndex {
  const byDistrict = new Map<string, AuctionComp[]>();
  const byTown = new Map<string, AuctionComp[]>();
  for (const c of comps) {
    if (!c.street || !c.ptype) continue;
    if (c.district) {
      const k = matchKey(c.district, c.street, c.ptype);
      (byDistrict.get(k) ?? byDistrict.set(k, []).get(k)!).push(c);
    }
    if (c.town) {
      const k = matchKey(c.town, c.street, c.ptype);
      (byTown.get(k) ?? byTown.set(k, []).get(k)!).push(c);
    }
  }
  return { byDistrict, byTown };
}

/** The listing price used for the discount test: guide (auction) preferred over asking. */
function listingPrice(l: AuctionListing): { price: number; label: 'guide' | 'asking' } | null {
  if (typeof l.guidePrice === 'number' && l.guidePrice > 0) return { price: l.guidePrice, label: 'guide' };
  if (typeof l.askingPrice === 'number' && l.askingPrice > 0) return { price: l.askingPrice, label: 'asking' };
  return null;
}

/**
 * Price-check one listing against the comp indexes. Returns the full comparison
 * (including `discounted`), or null when the listing has no usable price or no
 * comps join. Faithfully reproduces matcher.py: try the district key, fall back
 * to the town key; cap comps at maxCompPrice; filter to the 40%..160% like-for-
 * like band, falling back to all capped comps when fewer than two survive.
 */
export function matchListing(l: AuctionListing, index: CompIndex, opts: MatchOptions = {}): AuctionMatch | null {
  if (!l.street || !l.ptype) return null;
  const priced = listingPrice(l);
  if (!priced) return null;
  const { price, label } = priced;

  const threshold = opts.threshold ?? AUCTION_DISCOUNT_THRESHOLD;
  const maxCompPrice = opts.maxCompPrice ?? DEFAULT_MAX_COMP_PRICE;

  // 1. District key, then 2. town key (matcher.py order).
  let comps = l.district ? index.byDistrict.get(matchKey(l.district, l.street, l.ptype)) ?? [] : [];
  let matchBasis: 'district' | 'town' = 'district';
  let bucketLabel = l.district;
  if (comps.length === 0 && l.town) {
    comps = index.byTown.get(matchKey(l.town, l.street, l.ptype)) ?? [];
    matchBasis = 'town';
    bucketLabel = l.town;
  }
  if (comps.length === 0) return null;

  const capped = comps.filter((c) => c.price > 0 && c.price <= maxCompPrice);
  if (capped.length === 0) return null;

  // Like-for-like price band; fall back to all capped comps if too tight. Track the
  // comp rows (not just prices) so the evidence can name the comps behind the median.
  const lo = price * LIKE_BAND_LO;
  const hi = price * LIKE_BAND_HI;
  let likeComps = capped.filter((c) => c.price >= lo && c.price <= hi);
  if (likeComps.length < MIN_LIKE_COMPS) likeComps = capped;
  const likePrices = likeComps.map((c) => c.price);

  const medianComp = median(likePrices) ?? 0;
  if (medianComp <= 0) return null;
  const maxComp = Math.max(...likePrices);
  const avgComp = Math.round(likePrices.reduce((a, b) => a + b, 0) / likePrices.length);

  return {
    discounted: price <= medianComp * threshold,
    price,
    priceLabel: label,
    medianComp,
    maxComp,
    avgComp,
    compCount: likePrices.length,
    discountVsMedian: discountPct(price, medianComp),
    discountVsMax: discountPct(price, maxComp),
    discountVsAvg: discountPct(price, avgComp),
    matchBasis,
    bucketLabel,
    likeComps,
  };
}

/**
 * Confidence in the discount signal, 0..1. This is a PRICE-discount confidence,
 * not the historic lens's seller-motivation probability: the fractional discount
 * below the median, tempered by comp-sample reliability (a median off two comps
 * is far less trustworthy than off a dozen). Rounded to 4dp to match score.ts.
 */
export function auctionConfidence(match: AuctionMatch): number {
  const depth = Math.min(1, Math.max(0, match.discountVsMedian / 100));
  const reliability = Math.min(1, match.compCount / AUCTION_RELIABLE_COMPS);
  return Math.round(depth * reliability * 10000) / 10000;
}

/**
 * Ranked, plain-English discount reasons, strongest first. The headline mirrors
 * the brief's example ("guide 22% below S64 terraced median of 12 comps").
 */
export function auctionReasons(l: AuctionListing, match: AuctionMatch): string[] {
  const type = propertyTypeLabel(l.ptype).toLowerCase();
  const reasons: string[] = [
    `${match.priceLabel} ${Math.round(match.discountVsMedian)}% below ${match.bucketLabel} ${type} median of ${match.compCount} comps`,
  ];
  if (match.discountVsMax > 0) {
    reasons.push(`${Math.round(match.discountVsMax)}% below the top comp of ${gbp(match.maxComp)}`);
  }
  reasons.push(`${match.priceLabel} ${gbp(match.price)} vs ${gbp(match.medianComp)} median`);
  reasons.push(
    match.matchBasis === 'district'
      ? `matched on postcode district ${match.bucketLabel}`
      : `matched on town ${match.bucketLabel}`
  );
  return reasons;
}

/**
 * Turn a discounted listing + its match into the emit-contract ScrapedCandidate
 * (channel 'auction', so it carries guide/asking price - unlike the historic
 * lens). The radar block carries the discount confidence, ranked reasons, and the
 * two value estimates: estMarketValue is the comp median HPI-adjusted and
 * 5k-rounded; estAchievable is the listing price 5k-rounded (the price you can
 * actually acquire at).
 *
 * @param ctx.hpiFactor scalar applied to the comp median (default 1 = no adjustment).
 */
export function listingToCandidate(
  l: AuctionListing,
  match: AuctionMatch,
  ctx: { run: string; capturedAt: string; hpiFactor?: number }
): ScrapedCandidate {
  const hpiFactor = ctx.hpiFactor ?? 1;
  const ref = l.listingUrl && l.listingUrl.trim() ? l.listingUrl.trim() : `${l.postcode}:${l.address}`;
  return {
    address: l.address,
    postcode: l.postcode,
    propertyType: propertyTypeLabel(l.ptype),
    bedrooms: l.bedrooms,
    guidePrice: l.guidePrice,
    askingPrice: l.askingPrice,
    channel: 'auction',
    listingUrl: l.listingUrl,
    sourceRef: `arf:${ctx.run}:${ref}`,
    capturedAt: ctx.capturedAt,
    radar: {
      discountConfidence: auctionConfidence(match),
      discountReasons: auctionReasons(l, match),
      estMarketValue: round5k(match.medianComp * hpiFactor),
      estAchievable: round5k(match.price),
    },
  };
}
