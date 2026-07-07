/**
 * Legal Pack Analyser - pure types + money math (M11 / AC-18).
 *
 * This module is directive-free (no 'use client' / 'server-only') so BOTH the
 * client panel and the server orchestrator can import it. It holds:
 *   - the four-section result types (fees, clauses, notes, client summary),
 *   - the persisted `LegalPackAnalysis` shape stored on `deal.auction.legalPack`,
 *   - the pure SDLT / VAT / funds-required math that backs the fees section and
 *     the `auction.buyerFees` auto-fill.
 *
 * The verbatim Claude system prompt and the Zod validation of Claude's JSON live
 * server-side in `@/server/legal-pack/*`; nothing here reaches the Anthropic API.
 *
 * Ported faithfully from the prototype `legal-pack-analyser.html` (fee maths,
 * UK SDLT bands from 1 April 2025, funds-required breakdown).
 */

export type VatApplies = 'Yes' | 'No' | 'TBC';
export type Severity = 'High' | 'Medium' | 'Low';
export type SdltMode = 'standard' | 'additional' | 'overseas';

/** A single additional buyer cost lifted from the pack. */
export type Fee = {
  name: string;
  /** Flat amount in £ (0 if the fee is purely a percentage or is variable). */
  fixed: number;
  /** Percentage of the purchase price (0 if none). Both fixed + pct may be set. */
  pct: number;
  vatApplies: VatApplies;
  whenPayable: string;
  /** Optional qualifier, e.g. "min £500 whichever is higher". */
  note?: string;
};

export type Clause = {
  question: string;
  answer: string;
  severity: Severity;
};

/** The four-section analysis, in the app's friendly shape. */
export type LegalPackSections = {
  property?: string;
  fees: Fee[];
  clauses: Clause[];
  notes: string[];
  clientSummary: string;
};

/**
 * What we persist on `deal.auction.legalPack`: the four sections plus the
 * derived buyer-fees total and provenance. No PDF/DOCX bytes are stored.
 */
export type LegalPackAnalysis = LegalPackSections & {
  /** Total additional buyer costs at `purchasePriceUsed`, rounded to £. Backs auction.buyerFees. */
  buyerFees: number;
  purchasePriceUsed: number;
  sourceFilename: string;
  modelId: string;
  analysedAt: string; // ISO timestamp
  /** Present when a scanned/image-only pack degraded to manual entry. */
  warning?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fee maths
// ─────────────────────────────────────────────────────────────────────────────

/** True when a fee has a computable amount (a flat sum and/or a percentage). */
export function feeIsQuantified(fee: Fee): boolean {
  return (fee.fixed || 0) > 0 || (fee.pct || 0) > 0;
}

/**
 * The £ amount a fee resolves to at a given purchase price, including VAT when
 * `vatApplies === 'Yes'`. Returns null for a variable/unknown fee (no fixed,
 * no pct) so callers can surface it as "Variable" rather than £0.
 */
export function feeAmount(fee: Fee, price: number): number | null {
  const fixed = Number(fee.fixed) || 0;
  const pct = Number(fee.pct) || 0;
  if (fixed <= 0 && pct <= 0) return null;
  const raw = fixed + (pct / 100) * price;
  const vatMult = fee.vatApplies === 'Yes' ? 1.2 : 1;
  return raw * vatMult;
}

/** Human-readable basis for a fee, e.g. "£500 + 1% of price + VAT". */
export function feeBasisLabel(fee: Fee): string {
  const fixed = Number(fee.fixed) || 0;
  const pct = Number(fee.pct) || 0;
  const parts: string[] = [];
  if (fixed > 0) parts.push(`£${Math.round(fixed).toLocaleString('en-GB')}`);
  if (pct > 0) parts.push(`${pct}% of price`);
  const base = parts.join(' + ') || 'See note';
  const vatNote = fee.vatApplies === 'Yes' ? ' + VAT' : fee.vatApplies === 'TBC' ? ' (VAT TBC)' : '';
  return base + vatNote;
}

/**
 * Sum every quantified fee at a given price. `hasVariable` is true when at least
 * one fee could not be priced (surfaced to the partner as "+ variable costs").
 * The `total` is the figure that auto-fills `auction.buyerFees`.
 */
export function totalBuyerFees(fees: Fee[], price: number): { total: number; hasVariable: boolean } {
  let total = 0;
  let hasVariable = false;
  for (const f of fees) {
    const amt = feeAmount(f, price);
    if (amt === null) hasVariable = true;
    else total += amt;
  }
  return { total: Math.round(total), hasVariable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stamp Duty Land Tax (UK rates from 1 April 2025)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SDLT for a purchase price under one of three modes:
 *   - standard : primary residence (standard tiers)
 *   - additional : additional property / BTL (+5% surcharge on every band)
 *   - overseas : non-resident (+2% on the whole price on top of the additional bands)
 *
 * Estimate only - the report always tells the partner to verify with a solicitor.
 */
export function calcSdlt(price: number, mode: SdltMode): number {
  if (!(price > 0)) return 0;
  const additional = mode === 'additional' || mode === 'overseas';
  // [band width, rate] pairs. Standard: 0 / 2 / 5 / 10 / 12%. Additional: +5% each.
  const bands: [number, number][] = additional
    ? [[125_000, 0.05], [125_000, 0.07], [675_000, 0.1], [575_000, 0.15], [Infinity, 0.17]]
    : [[125_000, 0.0], [125_000, 0.02], [675_000, 0.05], [575_000, 0.1], [Infinity, 0.12]];

  let remaining = price;
  let tax = 0;
  for (const [width, rate] of bands) {
    const slice = Math.min(remaining, width);
    tax += slice * rate;
    remaining -= slice;
    if (remaining <= 0) break;
  }
  if (mode === 'overseas') tax += price * 0.02; // non-resident 2% surcharge
  return Math.round(tax);
}

// ─────────────────────────────────────────────────────────────────────────────
// Total funds required
// ─────────────────────────────────────────────────────────────────────────────

export type FundsRequiredInput = {
  price: number;
  fees: Fee[];
  depositPct?: number; // default 10
  sourcingFee?: number; // default 3000
  legalFees?: number; // default 1500
  sdltMode?: SdltMode; // default 'additional' (BTL)
};

export type FundsRequired = {
  deposit: number;
  balance: number;
  additionalCosts: number;
  hasVariableCosts: boolean;
  sdlt: number;
  sourcingFee: number;
  legalFees: number;
  total: number;
};

/**
 * Complete funds-required breakdown for an auction purchase: deposit on
 * exchange, balance on completion, additional buyer costs from the pack, SDLT,
 * sourcing fee and legal fees. Mirrors the prototype's completion summary.
 */
export function fundsRequired(input: FundsRequiredInput): FundsRequired {
  const price = Number(input.price) || 0;
  const depositPct = input.depositPct ?? 10;
  const sourcingFee = input.sourcingFee ?? 3000;
  const legalFees = input.legalFees ?? 1500;
  const sdltMode = input.sdltMode ?? 'additional';

  const deposit = Math.round(price * (depositPct / 100));
  const balance = price - deposit;
  const { total: additionalCosts, hasVariable } = totalBuyerFees(input.fees, price);
  const sdlt = calcSdlt(price, sdltMode);

  const total = deposit + balance + additionalCosts + sdlt + sourcingFee + legalFees;
  return {
    deposit,
    balance,
    additionalCosts,
    hasVariableCosts: hasVariable,
    sdlt,
    sourcingFee,
    legalFees,
    total,
  };
}

/** Parse a loose money string ("£112,500", "112500") to a number, or null. */
export function parseMoneyLoose(text: string | undefined | null): number | null {
  if (!text) return null;
  const n = Number(String(text).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
