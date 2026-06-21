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
    narratives: args.narratives ?? args.deal.narratives ?? {},
    fin: computeFinancials(args.deal),
    proj: computeGrowthProjection(args.deal),
  };
}
