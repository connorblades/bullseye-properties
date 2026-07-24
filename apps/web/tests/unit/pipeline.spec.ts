import { describe, expect, it } from 'vitest';
import { effectivePipelineStage, PIPELINE_COLUMNS, viewingSubState, viewingSubStateMeta } from '@/lib/pipeline';
import { emptyDeal } from '@/lib/deal-store';

describe('effectivePipelineStage', () => {
  it('derives the column from wizard progress when no explicit stage is set', () => {
    expect(effectivePipelineStage(emptyDeal('d', { progress: 1 }))).toBe('leads');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 2 }))).toBe('leads');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 5 }))).toBe('sourcing');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 8 }))).toBe('viewing');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 9 }))).toBe('viewing');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 12 }))).toBe('analysis');
    expect(effectivePipelineStage(emptyDeal('d', { progress: 14 }))).toBe('report');
    expect(effectivePipelineStage(emptyDeal('d', { delivered: true, progress: 8 }))).toBe('report');
  });

  it('uses the explicit partner-set pipelineStage when present (overrides derived)', () => {
    expect(effectivePipelineStage(emptyDeal('d', { progress: 1, pipelineStage: 'won' }))).toBe('won');
    expect(effectivePipelineStage(emptyDeal('d', { delivered: true, pipelineStage: 'followup' }))).toBe('followup');
  });

  it('ignores an invalid stored stage and falls back to derived', () => {
    // @ts-expect-error - simulate corrupt stored value
    expect(effectivePipelineStage(emptyDeal('d', { progress: 5, pipelineStage: 'bogus' }))).toBe('sourcing');
  });

  it('exposes 9 columns with unique keys', () => {
    expect(PIPELINE_COLUMNS).toHaveLength(9);
    expect(new Set(PIPELINE_COLUMNS.map((c) => c.key)).size).toBe(9);
  });
});

describe('viewingSubState', () => {
  it('is pre by default (prep / preview only, nothing captured)', () => {
    const d = emptyDeal('d');
    d.viewing.phase = 'pre';
    expect(viewingSubState(d)).toBe('pre');
  });

  it('is on when live capture is in progress', () => {
    const withPhoto = emptyDeal('d');
    withPhoto.viewing.photos = ['data:image/jpeg;base64,x'];
    expect(viewingSubState(withPhoto)).toBe('on');

    const withChecklistPhoto = emptyDeal('d');
    withChecklistPhoto.viewing.checklist = [{ key: 'roof', label: 'Roof', done: false, photo: 'data:x' }];
    expect(viewingSubState(withChecklistPhoto)).toBe('on');

    const withChecklistDone = emptyDeal('d');
    withChecklistDone.viewing.checklist = [{ key: 'roof', label: 'Roof', done: true }];
    expect(viewingSubState(withChecklistDone)).toBe('on');

    const withInspection = emptyDeal('d');
    withInspection.viewing.inspection = { rooms: [], steps: { boiler: { rating: 6 } } };
    expect(viewingSubState(withInspection)).toBe('on');

    const onTab = emptyDeal('d');
    onTab.viewing.phase = 'inspect';
    expect(viewingSubState(onTab)).toBe('on');
  });

  it('is post when the viewing is signed off, logged, given an outcome, or assessed', () => {
    const signedOff = emptyDeal('d');
    signedOff.viewing.signedOffAt = '2026-07-24T09:00:00.000Z';
    expect(viewingSubState(signedOff)).toBe('post');

    const logged = emptyDeal('d');
    logged.viewings = [{ id: 'v1', date: '2026-07-24', checklist: [], notes: '' }];
    expect(viewingSubState(logged)).toBe('post');

    const withOutcome = emptyDeal('d');
    withOutcome.viewing.outcome = 'proceed';
    expect(viewingSubState(withOutcome)).toBe('post');

    const assessed = emptyDeal('d');
    assessed.viewing.assessment = 'Solid, minor works.';
    expect(viewingSubState(assessed)).toBe('post');
  });

  it('lets a post signal win over an on signal', () => {
    const d = emptyDeal('d');
    d.viewing.photos = ['data:x'];               // on signal
    d.viewing.signedOffAt = '2026-07-24T09:00:00.000Z'; // post signal
    expect(viewingSubState(d)).toBe('post');
  });

  it('maps each sub-state to a label and the Stage 8 tab it links to', () => {
    expect(viewingSubStateMeta('pre')).toEqual({ label: 'Pre-viewing', tab: 'pre' });
    expect(viewingSubStateMeta('on')).toEqual({ label: 'On viewing', tab: 'on' });
    expect(viewingSubStateMeta('post')).toEqual({ label: 'Post-viewing', tab: 'post' });
  });
});
