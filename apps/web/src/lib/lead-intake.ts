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

/** Where a candidate came from, mapped onto Deal.source by mapSource(). */
export type LeadChannel = 'portal' | 'auction' | 'open-data' | 'direct';

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
    listingUrl: cleanString(raw.listingUrl),
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

/**
 * Dedupe key: compact upper-case postcode + the first house-number token from
 * the address. Two listings for the same door collapse to the same key even if
 * one came from a portal and one from auction. Empty string when neither the
 * postcode nor a house number is known.
 */
export function dedupeKey(c: ScrapedCandidate): string {
  const pc = c.postcode ? compactPostcode(c.postcode) : '';
  const numMatch = (c.address ?? '').match(/\d+[A-Za-z]?/);
  const num = numMatch ? numMatch[0].toUpperCase() : '';
  return `${pc}:${num}`;
}

/** The exact shape createDeal() consumes. */
export type CandidateDealInput = {
  address: string;
  source: Deal['source'];
  initialInputs: Partial<Deal>;
};

/** Nested jsonb metadata recording where a lead came from (no migration). */
export type LeadSourceMeta = {
  channel: LeadChannel;
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
 */
export function candidateToDealInput(raw: ScrapedCandidate): CandidateDealInput {
  const c = normaliseCandidate(raw);

  const purchasePrice = c.guidePrice ?? c.askingPrice;

  const leadSource: LeadSourceMeta = {
    channel: c.channel,
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

  if (c.client) initialInputs.client = c.client;

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
