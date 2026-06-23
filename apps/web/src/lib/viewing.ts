import type { Deal, StageRating, ViewingRecord, ViewingChecklistItem } from './deal-store';

/**
 * Viewing workflow helpers (M5). The on-viewing stage is a photo checklist of
 * 12 points; the post-viewing stage requires a human sign-off before the report
 * can go to a client. See [[project-viewing-workflow]].
 */

/** The 12 photo-checklist points captured at a viewing, in order. */
export const VIEWING_CHECKLIST: { key: string; label: string }[] = [
  { key: 'boiler', label: 'Boiler' },
  { key: 'fusebox', label: 'Fusebox' },
  { key: 'roof', label: 'Roof' },
  { key: 'soffits', label: 'Soffits & fascias' },
  { key: 'damp', label: 'Damp' },
  { key: 'driveway', label: 'Driveway' },
  { key: 'structure', label: 'Structure' },
  { key: 'chimney', label: 'Chimney breast' },
  { key: 'windows', label: 'Windows' },
  { key: 'doors', label: 'Doors' },
  { key: 'flooring', label: 'Flooring' },
  { key: 'other', label: 'Other concerns' },
];

/** Checklist keys that map back to the legacy condition ratings (for the PDF). */
export const CHECKLIST_TO_CONDITION: Partial<Record<string, keyof Deal['viewing']>> = {
  roof: 'roof',
  damp: 'damp',
  windows: 'windows',
  boiler: 'heating',
  fusebox: 'electrics',
  structure: 'structure',
};

export function defaultViewingChecklist(): ViewingChecklistItem[] {
  return VIEWING_CHECKLIST.map((c) => ({ key: c.key, label: c.label, done: false, rating: '' as StageRating }));
}

/** A checklist item counts as captured once it has a photo OR is explicitly ticked. */
export function checklistProgress(items: ViewingChecklistItem[] = []): { done: number; total: number } {
  const total = items.length || VIEWING_CHECKLIST.length;
  const done = items.filter((i) => i.done || !!i.photo).length;
  return { done, total };
}

/**
 * Post-viewing sign-off completeness - the human-in-the-loop gate before a
 * report goes to a client. Requires a sign-off and a top-level assessment.
 * Returns the list of missing requirements (empty = ready to send).
 */
export function postViewingBlockers(viewing: Deal['viewing']): string[] {
  const missing: string[] = [];
  if (!viewing.assessment?.trim()) missing.push('a top-level post-viewing assessment');
  if (!viewing.signedOffBy?.trim()) missing.push('your post-viewing sign-off (human review)');
  return missing;
}

export function isReadyForClient(viewing: Deal['viewing']): boolean {
  return postViewingBlockers(viewing).length === 0;
}

/** Snapshot the current working viewing into a dated history record. */
export function snapshotViewing(viewing: Deal['viewing'], attendee?: string): ViewingRecord {
  return {
    id: `v-${Math.random().toString(36).slice(2, 10)}`,
    date: new Date().toISOString(),
    attendee,
    checklist: (viewing.checklist ?? []).map((i) => ({ ...i })),
    notes: viewing.notes,
    assessment: viewing.assessment,
    comments: viewing.summary,
    outcome: viewing.outcome,
    signedOffBy: viewing.signedOffBy,
    signedOffAt: viewing.signedOffAt,
  };
}
