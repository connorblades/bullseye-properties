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

/**
 * Viewing sub-state (P3-M2): the three-part lifecycle a viewing moves through -
 * pre (preview / prep, not yet done), on (live capture in progress), post (viewed,
 * being closed out). Surfaced on the board card for a deal in the viewing column so
 * the partner sees at a glance where each viewing sits, and deep-links into the
 * matching Stage 8 tab. Derived from the Stage 8 state; no new field.
 */
export type ViewingSubState = 'pre' | 'on' | 'post';

/** The board label and the Stage 8 tab each sub-state links to. */
const VIEWING_SUBSTATE_META: Record<ViewingSubState, { label: string; tab: 'pre' | 'on' | 'post' }> = {
  pre: { label: 'Pre-viewing', tab: 'pre' },
  on: { label: 'On viewing', tab: 'on' },
  post: { label: 'Post-viewing', tab: 'post' },
};

export function viewingSubStateMeta(s: ViewingSubState): { label: string; tab: 'pre' | 'on' | 'post' } {
  return VIEWING_SUBSTATE_META[s];
}

/** True when the guided inspection has any real captured content. */
function inspectionHasData(ins: Deal['viewing']['inspection']): boolean {
  if (!ins) return false;
  if ((ins.rooms?.length ?? 0) > 0) return true;
  return Object.values(ins.steps ?? {}).some(
    (s) =>
      !!s &&
      (s.rating !== undefined ||
        !!s.notes?.trim() ||
        !!s.reading?.trim() ||
        !!s.flagged ||
        (s.photos?.length ?? 0) > 0 ||
        !!s.cost)
  );
}

/**
 * Derive the pre / on / post viewing sub-state from a deal's Stage 8 state. Ordered
 * strongest signal first: a viewing that has been signed off, logged to history, or
 * given an outcome / assessment is post; one with any live capture (inspection data,
 * checklist photos, or the partner sitting on the on/inspect tab) is on; otherwise
 * it is still pre (prep / preview only).
 */
export function viewingSubState(deal: Deal): ViewingSubState {
  const v = deal.viewing;
  if (!v) return 'pre';
  // POST - the viewing happened and is being closed out.
  if (v.signedOffAt || v.signedOffBy) return 'post';
  if ((deal.viewings?.length ?? 0) > 0) return 'post';
  if (v.outcome) return 'post';
  if (v.assessment?.trim() || v.summary?.trim()) return 'post';
  // ON - live capture in progress.
  if (inspectionHasData(v.inspection)) return 'on';
  if ((v.checklist ?? []).some((i) => i.done || !!i.photo)) return 'on';
  if ((v.photos?.length ?? 0) > 0) return 'on';
  if (v.phase === 'on' || v.phase === 'inspect') return 'on';
  // PRE - prep / preview only.
  return 'pre';
}
