/**
 * Lead-intake core (M5, Stage 1).
 *
 * Pure + client-safe: no 'use client'/'use server' directive and no imports of
 * server-only modules, so it can run in the browser (paste/preview a scraped
 * candidate) and on the server (turn it into a Deal via createDeal). It is the
 * normalisation + mapping layer between a scraped listing and the Deal model.
 *
 * A `ScrapedCandidate` is whatever a portal/auction/open-data/direct scraper
 * produced. `normaliseCandidate` cleans it, `candidateToDealInput` turns it into
 * the exact `{address, source, initialInputs}` shape createDeal() expects, with
 * `pipelineStage: 'leads'` so every intake lands as a new lead on the board.
 */

import type { Deal } from './deal-store';
import { emptyDeal } from './deal-factory';
import { scoreLeadFit } from './lead-score';

/** Where a candidate came from, mapped onto Deal.source by mapSource(). */
export type LeadChannel = 'portal' | 'auction' | 'open-data' | 'direct';

/**
 * Whether the property is actively for sale right now (on-market: portals,
 * auctions, Facebook Marketplace, Gumtree) or surfaced by prediction before it
 * lists (off-market: Deal Radar open-data, cold direct-to-vendor). Shown as a tag
 * in the review inbox so a partner sees at a glance what kind of lead it is.
 */
export type LeadMarket = 'on-market' | 'off-market';

/**
 * The market tag for a candidate: an explicit `market` always wins (so a
 * Facebook Marketplace / Gumtree scraper can flag its listings on-market even
 * though they are private-seller, not portal). Otherwise open-data and direct
 * default to off-market, portal and auction to on-market.
 */
export function leadMarket(c: { channel: LeadChannel; market?: LeadMarket }): LeadMarket {
  if (c.market === 'on-market' || c.market === 'off-market') return c.market;
  switch (c.channel) {
    case 'portal':
    case 'auction':
      return 'on-market';
    case 'open-data':
    case 'direct':
    default:
      return 'off-market';
  }
}

/** Default per-channel source labels when the scraper did not name a source. */
const CHANNEL_LABEL: Record<LeadChannel, string> = {
  portal: 'Estate agent',
  auction: 'Auction',
  'open-data': 'Deal Radar',
  direct: 'Direct to vendor',
};

/**
 * Human-readable source label for a candidate. An explicit `sourceName` (e.g.
 * "Facebook Marketplace", "Gumtree", "Rightmove") wins; otherwise it falls back
 * to a sensible label for the channel.
 */
export function leadSourceLabel(c: { channel: LeadChannel; sourceName?: string }): string {
  const named = typeof c.sourceName === 'string' ? c.sourceName.trim() : '';
  return named || CHANNEL_LABEL[c.channel] || 'Unknown source';
}

/** Investor criteria carried alongside a candidate (matched-lead intake). */
export type CandidateCriteria = {
  budget?: string;
  areas?: string;
  propertyType?: string;
  targetYield?: string;
};

/**
 * Radar signals from the discount-detection pass. Confidence is 0..1; the two
 * value estimates are in whole pounds. All optional - a candidate may arrive
 * before radar has run.
 */
export type CandidateRadar = {
  discountConfidence?: number;
  discountReasons?: string[];
  estMarketValue?: number;
  estAchievable?: number;
  /**
   * Approach-target metadata on an ALREADY company-keyed lead (M10): the name of
   * the person with significant control behind the owning company, from Companies
   * House PSC. Never a discovery source - it only annotates a lead the corporate
   * (CCOD) join already produced.
   */
  approachTarget?: string;
};

/**
 * A scraped listing candidate, pre-Deal. `address` is the only hard requirement;
 * everything else is best-effort from the source.
 */
export type ScrapedCandidate = {
  address: string;
  postcode?: string;
  propertyType?: string;
  bedrooms?: number;
  guidePrice?: number;
  askingPrice?: number;
  expectedRent?: number;
  tenure?: string;
  epcRating?: string;
  channel: LeadChannel;
  /** On-market vs off-market tag; defaults from channel via leadMarket(). */
  market?: LeadMarket;
  /** Display name of the source, e.g. "Facebook Marketplace", "Gumtree". */
  sourceName?: string;
  listingUrl?: string;
  sourceRef?: string;
  capturedAt?: string;
  client?: string;
  criteria?: CandidateCriteria;
  radar?: CandidateRadar;
};

/** Trim a free-text value, returning undefined for empty/whitespace-only. */
function cleanString(s?: string): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 0 ? t : undefined;
}

/** Keep a trimmed value only when it is an absolute http(s) URL, else undefined. */
function cleanHttpUrl(s?: string): string | undefined {
  const t = cleanString(s);
  if (!t) return undefined;
  return /^https?:\/\/\S+$/i.test(t) ? t : undefined;
}

/** Coerce to a finite positive number, or undefined. */
function cleanPositive(n?: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Non-negative finite number (bedrooms can legitimately be 0 for a studio). */
function cleanNonNegative(n?: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Compact + upper-case a postcode ("ng18 5qh" -> "NG185QH"). */
function compactPostcode(pc: string): string {
  return pc.replace(/\s+/g, '').toUpperCase();
}

// Same shape as the geocode module's UK_POSTCODE_RE, duplicated here to keep
// this module free of server imports. Kept in sync with extractPostcode.
const UK_POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;

/** Format a compact postcode back to canonical "OUTWARD INWARD" upper form. */
function formatPostcode(pc: string): string {
  const compact = compactPostcode(pc);
  if (compact.length < 5) return compact;
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

/**
 * Clean a raw candidate: trim strings, drop empty/invalid numbers, normalise the
 * channel, and backfill `postcode` from the address when the scraper missed it.
 * Idempotent - normalising an already-normalised candidate is a no-op.
 */
export function normaliseCandidate(raw: ScrapedCandidate): ScrapedCandidate {
  const address = cleanString(raw.address) ?? '';

  // Prefer an explicit postcode; otherwise pull one out of the address.
  let postcode = cleanString(raw.postcode);
  if (!postcode) {
    const m = address.match(UK_POSTCODE_RE);
    if (m) postcode = m[1];
  }
  if (postcode) postcode = formatPostcode(postcode);

  const criteria = raw.criteria
    ? {
        budget: cleanString(raw.criteria.budget),
        areas: cleanString(raw.criteria.areas),
        propertyType: cleanString(raw.criteria.propertyType),
        targetYield: cleanString(raw.criteria.targetYield),
      }
    : undefined;

  const radar = raw.radar
    ? {
        discountConfidence: cleanNonNegative(raw.radar.discountConfidence),
        discountReasons: Array.isArray(raw.radar.discountReasons)
          ? raw.radar.discountReasons.map((r) => cleanString(r)).filter((r): r is string => !!r)
          : undefined,
        estMarketValue: cleanPositive(raw.radar.estMarketValue),
        estAchievable: cleanPositive(raw.radar.estAchievable),
        approachTarget: cleanString(raw.radar.approachTarget),
      }
    : undefined;

  return {
    address,
    postcode,
    propertyType: cleanString(raw.propertyType),
    bedrooms: cleanNonNegative(raw.bedrooms),
    guidePrice: cleanPositive(raw.guidePrice),
    askingPrice: cleanPositive(raw.askingPrice),
    expectedRent: cleanPositive(raw.expectedRent),
    tenure: cleanString(raw.tenure),
    epcRating: cleanString(raw.epcRating)?.toUpperCase(),
    channel: raw.channel,
    market: raw.market === 'on-market' || raw.market === 'off-market' ? raw.market : undefined,
    sourceName: cleanString(raw.sourceName),
    listingUrl: cleanHttpUrl(raw.listingUrl),
    sourceRef: cleanString(raw.sourceRef),
    capturedAt: cleanString(raw.capturedAt),
    client: cleanString(raw.client),
    criteria,
    radar,
  };
}

/**
 * Map a candidate's channel to Deal.source:
 *   portal    -> estate-agent
 *   auction   -> auction
 *   open-data -> direct-to-vendor
 *   direct    -> direct-to-vendor
 */
export function mapSource(c: ScrapedCandidate): Deal['source'] {
  switch (c.channel) {
    case 'portal':
      return 'estate-agent';
    case 'auction':
      return 'auction';
    case 'open-data':
    case 'direct':
    default:
      return 'direct-to-vendor';
  }
}

/**
 * Build an address string guaranteed to contain the postcode (when known) so
 * server-side extractPostcode() succeeds. If the address already carries a
 * postcode it is returned as-is; otherwise the postcode is appended.
 */
export function composeAddress(c: ScrapedCandidate): string {
  const address = (c.address ?? '').trim();
  const pc = c.postcode ? formatPostcode(c.postcode) : undefined;
  if (!pc) return address;

  // Already contains a postcode? Leave it - don't duplicate.
  if (UK_POSTCODE_RE.test(address)) return address;

  if (!address) return pc;
  return `${address}, ${pc}`;
}

/** Lowercase, strip punctuation, collapse whitespace: an address dedupe token. */
function normaliseAddressKey(address?: string): string {
  return (address ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Dedupe key for one physical door.
 *
 * With a postcode it is the strong key - compact upper-case postcode + the first
 * house-number token - so the same door collapses to one lead even when one copy
 * came from a portal and one from auction (`NG185QH:12`).
 *
 * Without a postcode it falls back to the full normalised address (house number
 * + street + town, e.g. `addr:12 blyth road worksop`). The bare postcode key
 * would be `:12` for EVERY no-postcode listing sharing a house number, so all but
 * the first collide and are wrongly skipped as duplicates - roughly half the
 * portal yield, which often omits the postcode. The address form still dedupes
 * exact re-posts (idempotent feeder re-runs) while keeping different streets and
 * towns distinct. The `addr:` prefix can never collide with a postcode key.
 *
 * Empty string only when neither a postcode nor any address text is known.
 */
export function dedupeKey(c: ScrapedCandidate): string {
  const pc = c.postcode ? compactPostcode(c.postcode) : '';
  if (pc) {
    const numMatch = (c.address ?? '').match(/\d+[A-Za-z]?/);
    const num = numMatch ? numMatch[0].toUpperCase() : '';
    return `${pc}:${num}`;
  }

  const addr = normaliseAddressKey(c.address);
  return addr ? `addr:${addr}` : '';
}

/**
 * The best-match summary the matcher (investor-match.ts) attaches to a lead at
 * ingest and persists in the candidate jsonb. Compact by design: the ranked
 * detail lives in the matcher's return, this is what the review card and the
 * approved deal need. `matched` is false when no active investor scored above
 * the fit floor - the lead is still shown, flagged unmatched.
 */
export type LeadMatchSummary = {
  matched: boolean;
  investorId?: string;
  investorName?: string;
  pct: number;
  reasons: string[];
  /** Next-best investors (name + fit), for context on the card. */
  alternatives?: { name: string; pct: number }[];
};

/**
 * A stored lead_candidate's `candidate` jsonb: the normalised ScrapedCandidate
 * plus the match summary written at ingest. Cast target for reads of the row's
 * jsonb (the column is untyped at rest).
 */
export type StoredCandidate = ScrapedCandidate & { match?: LeadMatchSummary };

/** The exact shape createDeal() consumes. */
export type CandidateDealInput = {
  address: string;
  source: Deal['source'];
  initialInputs: Partial<Deal>;
};

/** Nested jsonb metadata recording where a lead came from (no migration). */
export type LeadSourceMeta = {
  channel: LeadChannel;
  market?: LeadMarket;
  sourceName?: string;
  listingUrl?: string;
  sourceRef?: string;
  capturedAt?: string;
  discountConfidence?: number;
  discountReasons?: string[];
  estMarketValue?: number;
  estAchievable?: number;
};

/**
 * Turn a scraped candidate into createDeal() input. Normalises first, then:
 *   - address carries the postcode (composeAddress)
 *   - source is mapped from channel
 *   - initialInputs seeds pipelineStage 'leads', client, criteria, property
 *     (type/bedrooms/askingPrice), financials (purchasePrice from guide/asking,
 *     monthlyRent from expectedRent), and a leadSource metadata group.
 *
 * When a `match` is supplied (BSE-OPP-P01 M1) and it matched an investor, the
 * deal is attached to that investor: `client` becomes the investor's name and a
 * `matchedInvestor` block (id, fit, reasons) rides onto the deal so the pipeline
 * knows who the lead is for. An explicit matched investor wins over the
 * candidate's own `client`.
 */
export function candidateToDealInput(
  raw: ScrapedCandidate,
  match?: LeadMatchSummary
): CandidateDealInput {
  const c = normaliseCandidate(raw);

  const purchasePrice = c.guidePrice ?? c.askingPrice;

  const leadSource: LeadSourceMeta = {
    channel: c.channel,
    market: leadMarket(c),
    sourceName: leadSourceLabel(c),
    listingUrl: c.listingUrl,
    sourceRef: c.sourceRef,
    capturedAt: c.capturedAt,
    discountConfidence: c.radar?.discountConfidence,
    discountReasons: c.radar?.discountReasons,
    estMarketValue: c.radar?.estMarketValue,
    estAchievable: c.radar?.estAchievable,
  };

  const initialInputs: Partial<Deal> = {
    pipelineStage: 'leads',
    leadSource,
  };

  // A matched investor is the deal's client and rides on as matchedInvestor;
  // otherwise fall back to any client the candidate itself carried.
  if (match?.matched && match.investorName) {
    initialInputs.client = match.investorName;
    initialInputs.matchedInvestor = {
      id: match.investorId ?? '',
      name: match.investorName,
      pct: match.pct,
      reasons: match.reasons,
    };
  } else if (c.client) {
    initialInputs.client = c.client;
  }

  if (c.criteria) {
    initialInputs.criteria = {
      budget: c.criteria.budget ?? '',
      areas: c.criteria.areas ?? '',
      propertyType: c.criteria.propertyType ?? '',
      targetYield: c.criteria.targetYield ?? '',
      refurbTolerance: '',
      epcRequirement: '',
      timeline: '',
    };
  }

  initialInputs.property = {
    type: c.propertyType ?? '',
    bedrooms: c.bedrooms !== undefined ? String(c.bedrooms) : '',
    bathrooms: '',
    floorArea: '',
    plotSize: '',
    parking: '',
    yearBuilt: '',
    heating: '',
    askingPrice: c.askingPrice !== undefined ? String(c.askingPrice) : '',
    documents: [],
  };

  initialInputs.financials = {
    purchasePrice: purchasePrice !== undefined ? String(purchasePrice) : '',
    monthlyRent: c.expectedRent !== undefined ? String(c.expectedRent) : '',
    annualCosts: '',
  };

  return {
    address: composeAddress(c),
    source: mapSource(c),
    initialInputs,
  };
}

/**
 * Build a draft Deal from a candidate and score its fit (0..100). Pure: no DB.
 * Lives here (not in the 'use server' lead-review module) so it can be unit
 * tested and reused by the ingest API route without a server-action boundary.
 */
export function fitForCandidate(raw: ScrapedCandidate): number {
  const { address, initialInputs } = candidateToDealInput(raw);
  // Seed the draft with the composed address too - scoreLeadFit's area check
  // reads deal.address, which lives outside initialInputs.
  const draft = emptyDeal(`lc-draft-${dedupeKey(raw)}`, { ...initialInputs, address });
  return scoreLeadFit(draft).pct;
}
