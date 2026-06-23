import { describe, expect, it } from 'vitest';
import { effectivePipelineStage, PIPELINE_COLUMNS } from '@/lib/pipeline';
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
