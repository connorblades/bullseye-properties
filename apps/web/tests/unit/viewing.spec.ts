import { describe, expect, it } from 'vitest';
import {
  VIEWING_CHECKLIST,
  defaultViewingChecklist,
  checklistProgress,
  postViewingBlockers,
  isReadyForClient,
  snapshotViewing,
} from '@/lib/viewing';
import { emptyDeal } from '@/lib/deal-store';

describe('viewing checklist', () => {
  it('has the 12 expected photo points', () => {
    expect(VIEWING_CHECKLIST).toHaveLength(12);
    const labels = VIEWING_CHECKLIST.map((c) => c.label);
    expect(labels).toContain('Boiler');
    expect(labels).toContain('Fusebox');
    expect(labels).toContain('Chimney breast');
    expect(labels).toContain('Other concerns');
  });

  it('defaultViewingChecklist seeds 12 un-done items', () => {
    const cl = defaultViewingChecklist();
    expect(cl).toHaveLength(12);
    expect(cl.every((i) => !i.done && !i.photo)).toBe(true);
  });

  it('checklistProgress counts items with a photo or ticked', () => {
    const cl = defaultViewingChecklist();
    cl[0].photo = 'data:image/jpeg;base64,xxx';
    cl[1].done = true;
    expect(checklistProgress(cl)).toEqual({ done: 2, total: 12 });
  });
});

describe('post-viewing sign-off gate', () => {
  it('blocks until assessment + sign-off are present', () => {
    const v = emptyDeal('d').viewing;
    expect(postViewingBlockers(v).length).toBe(2);
    expect(isReadyForClient(v)).toBe(false);

    v.assessment = 'Sound structurally; minor damp.';
    expect(postViewingBlockers(v)).toEqual(['your post-viewing sign-off (human review)']);
    expect(isReadyForClient(v)).toBe(false);

    v.signedOffBy = 'Connor Blades';
    expect(postViewingBlockers(v)).toEqual([]);
    expect(isReadyForClient(v)).toBe(true);
  });
});

describe('snapshotViewing', () => {
  it('captures a dated copy of the current viewing for history', () => {
    const v = emptyDeal('d').viewing;
    v.assessment = 'Good';
    v.outcome = 'proceed';
    const rec = snapshotViewing(v, '2nd viewing');
    expect(rec.id).toMatch(/^v-/);
    expect(rec.attendee).toBe('2nd viewing');
    expect(rec.assessment).toBe('Good');
    expect(rec.outcome).toBe('proceed');
    expect(rec.checklist).toHaveLength(12);
    expect(typeof rec.date).toBe('string');
  });
});
