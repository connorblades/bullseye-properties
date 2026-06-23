import type { Deal, PipelineStage } from './deal-store';

/**
 * Pipeline / CRM board model (M5).
 *
 * The board column is the partner-controlled `deal.pipelineStage` when set,
 * otherwise it is derived from the deal's wizard progress (so existing deals
 * land in a sensible column with no migration and no manual triage). Sourcing
 * stages (leads -> report) mirror wizard progress; the sales stages
 * (offer/won/lost/followup) are set by the partner as the deal moves.
 */

export type PipelineColumnKey = PipelineStage;

export const PIPELINE_COLUMNS: { key: PipelineColumnKey; label: string; hint: string; tone: 'navy' | 'success' | 'red' | 'amber' }[] = [
  { key: 'leads', label: 'Leads', hint: 'New + client criteria', tone: 'navy' },
  { key: 'sourcing', label: 'Sourcing', hint: 'Auto-pull, property, comps', tone: 'navy' },
  { key: 'viewing', label: 'Viewing', hint: 'On-site + due diligence', tone: 'navy' },
  { key: 'analysis', label: 'Analysis', hint: 'Growth, refurb, financials', tone: 'navy' },
  { key: 'report', label: 'Report sent', hint: 'Generated + delivered', tone: 'navy' },
  { key: 'offer', label: 'Offer submitted', hint: 'Offer with vendor/agent', tone: 'amber' },
  { key: 'won', label: 'Won', hint: 'Offer accepted', tone: 'success' },
  { key: 'lost', label: 'Lost', hint: 'Declined / dead', tone: 'red' },
  { key: 'followup', label: 'Follow-up', hint: 'Nurture / revisit', tone: 'amber' },
];

const COLUMN_KEYS = PIPELINE_COLUMNS.map((c) => c.key);

/** Derive a column from wizard progress when no explicit pipelineStage is set. */
function derivePipelineStage(deal: Deal): PipelineColumnKey {
  if (deal.delivered) return 'report';
  const p = deal.progress;
  if (p <= 2) return 'leads';
  if (p <= 7) return 'sourcing';
  if (p <= 9) return 'viewing';
  if (p <= 13) return 'analysis';
  return 'report';
}

/** The column a deal belongs in: explicit stage wins, else derived. */
export function effectivePipelineStage(deal: Deal): PipelineColumnKey {
  if (deal.pipelineStage && COLUMN_KEYS.includes(deal.pipelineStage)) return deal.pipelineStage;
  return derivePipelineStage(deal);
}
