import { describe, expect, it } from 'vitest';
import { activeInspectionIndex, emptyInspection, inspectionReviewProgress, stepReviewed, stepsForProperty } from '@/lib/inspection';
import type { InspectionState } from '@/lib/inspection';
import { snapshotViewing, withInspection } from '@/lib/viewing';
import { emptyDeal } from '@/lib/deal-factory';

describe('guided inspection observations', () => {
  it('does not interpret a photo, rating, reading or cost as an explicit review', () => {
    expect(stepReviewed({ rating: 10, photos: ['photo'], reading: '1.5 bar', cost: { quantity: 1 } })).toBe(false);
    expect(stepReviewed({ flagged: false })).toBe(false);
  });
  it.each(['not-inspected', 'not-applicable'] as const)('requires a reason for %s', (result) => {
    expect(stepReviewed({ result })).toBe(false);
    expect(stepReviewed({ result, notes: '  ' })).toBe(false);
    expect(stepReviewed({ result, notes: 'Loft hatch locked; return visit needed.' })).toBe(true);
  });
  it('keeps concerns and inaccessible checks visible without issuing a pass', () => {
    const state: InspectionState = { rooms: [], steps: {
      'ridge-tiles': { result: 'no-concern' },
      'chimney-flashing': { result: 'concern' },
      soffits: { result: 'not-inspected', notes: 'Obscured by scaffolding' },
      fascias: { photos: ['photo'] },
    } };
    expect(inspectionReviewProgress(state, stepsForProperty({ endOrSemi: false }))).toMatchObject({ reviewed: 3, concerns: 1, notInspected: 1 });
  });
  it('does not count a check hidden for this property type', () => {
    const state: InspectionState = { rooms: [], steps: { 'gable-caps': { result: 'concern' } } };
    expect(inspectionReviewProgress(state, stepsForProperty({ endOrSemi: false })).concerns).toBe(0);
    expect(inspectionReviewProgress(state, stepsForProperty({ endOrSemi: true })).concerns).toBe(1);
  });
});

describe('resume and viewing history', () => {
  const steps = stepsForProperty({ endOrSemi: false });
  it('requires new sign-off after changing evidence, but preserves sign-off when moving between checks', () => {
    const viewing = emptyDeal('test').viewing;
    viewing.inspection = emptyInspection();
    viewing.signedOffBy = 'Reviewer';
    viewing.signedOffAt = '2026-11-08T00:00:00Z';
    expect(withInspection(viewing, { ...viewing.inspection, activeStepKey: steps[0].key }).signedOffBy).toBe('Reviewer');
    const revised = withInspection(viewing, { ...viewing.inspection, steps: { [steps[0].key]: { result: 'concern' } } });
    expect(revised.signedOffBy).toBe('');
    expect(revised.signedOffAt).toBe('');
  });
  it('starts with the first check and resumes unresolved legacy captures without losing them', () => {
    expect(activeInspectionIndex(emptyInspection(), steps)).toBe(0);
    const state: InspectionState = { rooms: [], steps: { [steps[0].key]: { result: 'no-concern' }, [steps[1].key]: { rating: 8 } } };
    expect(activeInspectionIndex(state, steps)).toBe(1);
  });
  it('preserves the chosen check while entering data; falls back when a conditional step is hidden', () => {
    const state: InspectionState = { rooms: [], activeStepKey: steps[0].key, steps: { [steps[0].key]: { result: 'no-concern' } } };
    expect(activeInspectionIndex(state, steps)).toBe(0);
    state.activeStepKey = 'gable-caps';
    expect(activeInspectionIndex(state, steps)).toBe(1);
  });
  it('keeps an independent snapshot of room measurements, photos, observations and costs', () => {
    const viewing = emptyDeal('test').viewing;
    viewing.inspection = {
      rooms: [{ id: 'r1', name: 'Lounge', lengthM: 4, widthM: 3, heightM: 2.4, works: ['plaster'], photos: ['room-photo'], rating: 5 }],
      steps: { windows: { result: 'concern', photos: ['window-photo'], cost: { quantity: 2 } } },
    };
    const record = snapshotViewing(viewing);
    viewing.inspection.rooms[0].lengthM = 10;
    viewing.inspection.rooms[0].photos!.push('new-photo');
    viewing.inspection.steps.windows.cost!.quantity = 9;
    expect(record.inspection?.rooms[0]).toMatchObject({ lengthM: 4, photos: ['room-photo'], rating: 5 });
    expect(record.inspection?.steps.windows.cost?.quantity).toBe(2);
  });
});
