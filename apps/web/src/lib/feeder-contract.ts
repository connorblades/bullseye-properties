/**
 * Feeder -> ingress contract validation (BSE-OPP-P01 M2, formalised).
 *
 * Pure + client-safe: no server imports, so the ingress route, any in-session
 * ingest, and tests all validate a posted payload against the SAME contract. It
 * is the typed boundary the off-platform feeders (Connor's Rightmove scraper, an
 * auction/EIG feed, a licensed data feed) post into - see
 * `opportunity-finder/docs/feeder-contract.md`.
 *
 * `normaliseCandidate` (lead-intake.ts) cleans a well-formed candidate; this layer
 * runs BEFORE it to REJECT malformed items with a clear per-item reason, so a
 * feeder gets actionable feedback ("candidates[3]: channel must be one of ...")
 * instead of a silently mangled lead. address + channel are the hard contract;
 * everything else is best-effort and only type-checked when present.
 */

import type { LeadChannel, LeadMarket, ScrapedCandidate } from './lead-intake';

/** The contract version, surfaced in the ingress response so feeders can pin it. */
export const FEEDER_CONTRACT_VERSION = '2025-07-13';

export const LEAD_CHANNELS: readonly LeadChannel[] = ['portal', 'auction', 'open-data', 'direct'];
export const LEAD_MARKETS: readonly LeadMarket[] = ['on-market', 'off-market'];

/** Optional numeric listing facts, validated only when present. */
const NUMERIC_FIELDS = ['bedrooms', 'guidePrice', 'askingPrice', 'expectedRent'] as const;

export type CandidateValidation =
  | { ok: true; value: ScrapedCandidate }
  | { ok: false; errors: string[] };

/**
 * Validate one raw payload item against the ScrapedCandidate contract. Returns the
 * item typed as ScrapedCandidate when valid, or the list of reasons it failed. It
 * does not clean or normalise - that is normaliseCandidate's job on the accepted
 * value. Covers both feeder shapes: a Rightmove/portal listing (channel 'portal')
 * and an auction/EIG lot (channel 'auction') differ only by channel + which price
 * field they carry, both of which this checks.
 */
export function validateCandidate(raw: unknown): CandidateValidation {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['candidate must be an object'] };
  }
  const o = raw as Record<string, unknown>;

  // Hard contract: address + channel.
  if (typeof o.address !== 'string' || o.address.trim().length === 0) {
    errors.push('address is required (non-empty string)');
  }
  if (typeof o.channel !== 'string' || !LEAD_CHANNELS.includes(o.channel as LeadChannel)) {
    errors.push(`channel must be one of ${LEAD_CHANNELS.join(', ')}`);
  }

  // Best-effort fields: only type-checked when present.
  if (o.market !== undefined && !LEAD_MARKETS.includes(o.market as LeadMarket)) {
    errors.push(`market, when set, must be one of ${LEAD_MARKETS.join(', ')}`);
  }
  for (const key of NUMERIC_FIELDS) {
    const v = o[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
      errors.push(`${key}, when set, must be a finite number`);
    }
  }
  for (const key of ['postcode', 'propertyType', 'sourceName', 'listingUrl', 'sourceRef'] as const) {
    if (o[key] !== undefined && typeof o[key] !== 'string') {
      errors.push(`${key}, when set, must be a string`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: raw as ScrapedCandidate };
}

export type BatchValidation = {
  /** The accepted candidates, in payload order. */
  valid: ScrapedCandidate[];
  /** One entry per rejected item: its index, best-effort address, and reasons. */
  invalid: { index: number; address: string; reason: string }[];
};

/**
 * Partition a posted candidates array into accepted + rejected. Fail-soft at the
 * item level: a malformed item is reported (never throws) and the rest proceed,
 * mirroring the ingest loop's per-item resilience.
 */
export function validateCandidateBatch(candidates: unknown[]): BatchValidation {
  const valid: ScrapedCandidate[] = [];
  const invalid: BatchValidation['invalid'] = [];

  candidates.forEach((raw, index) => {
    const result = validateCandidate(raw);
    if (result.ok) {
      valid.push(result.value);
    } else {
      const address =
        typeof (raw as { address?: unknown })?.address === 'string'
          ? ((raw as { address: string }).address)
          : '(unknown)';
      invalid.push({ index, address, reason: result.errors.join('; ') });
    }
  });

  return { valid, invalid };
}
