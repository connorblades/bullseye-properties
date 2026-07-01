import 'server-only';
import type { Deal } from '@/lib/deal-store';
import { computeFinancials, computeGrowthProjection, type ComputedFinancials, type GrowthProjection } from '@/lib/deal-calcs';
import type { SectionKey } from '@/server/claude/prompts';
import type { PartnerIdentity } from './components';

/**
 * The single data contract every PDF section component reads (M3-T6 foundation).
 *
 * Assembled once from the Deal + partner + published narratives; carries the
 * precomputed financials and growth projection so section components never
 * recompute (and never diverge). Section groups receive `{ data }: { data:
 * ReportData }` and read only from here.
 */
export type ReportData = {
  reference: string;
  address: string;
  preparedFor?: string;
  generatedOn?: string; // dd/mm/yyyy
  partner: PartnerIdentity;
  deal: Deal;
  narratives: Partial<Record<SectionKey, string>>;
  fin: ComputedFinancials;
  proj: GrowthProjection;
};

/**
 * Strip internal `[VERIFY: ...]` partner prompts from a narrative before it
 * reaches the investor PDF. These are editorial notes the AI adds when a fact is
 * missing (the partner resolves them in the wizard); they must never be printed
 * in the delivered report. Markers can span lines, so the class negation
 * (which includes newlines) matches multi-line blocks. Leftover blank lines and
 * doubled spaces are tidied up.
 */
export function stripVerifyMarkers(text: string): string {
  return text
    .replace(/\[VERIFY:[^\]]*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function sanitizeNarratives(
  narratives: Partial<Record<SectionKey, string>>,
): Partial<Record<SectionKey, string>> {
  const out: Partial<Record<SectionKey, string>> = {};
  for (const [k, v] of Object.entries(narratives)) {
    if (typeof v === 'string') out[k as SectionKey] = stripVerifyMarkers(v);
  }
  return out;
}

export function buildReportData(args: {
  deal: Deal;
  reference: string;
  partner: PartnerIdentity;
  preparedFor?: string;
  generatedOn?: string;
  narratives?: Partial<Record<SectionKey, string>>;
}): ReportData {
  return {
    reference: args.reference,
    address: args.deal.address,
    preparedFor: args.preparedFor,
    generatedOn: args.generatedOn,
    partner: args.partner,
    deal: args.deal,
    narratives: sanitizeNarratives(args.narratives ?? args.deal.narratives ?? {}),
    fin: computeFinancials(args.deal),
    proj: computeGrowthProjection(args.deal),
  };
}
