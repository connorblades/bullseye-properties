import { describe, expect, it } from 'vitest';
import { SECTIONS, WIZARD_PHASES, stepsInPhase } from '@/lib/sections';

describe('wizard phases (two-report flow)', () => {
  it('every section has a phase and phases run pre -> viewing -> post contiguously', () => {
    expect(SECTIONS.every((s) => !!s.phase)).toBe(true);
    const order = SECTIONS.map((s) => s.phase);
    // No phase reappears after a later phase started (contiguous blocks).
    const firstIndex = { pre: order.indexOf('pre'), viewing: order.indexOf('viewing'), post: order.indexOf('post') };
    expect(firstIndex.pre).toBeLessThan(firstIndex.viewing);
    expect(firstIndex.viewing).toBeLessThan(firstIndex.post);
    expect(order.lastIndexOf('pre')).toBeLessThan(firstIndex.viewing);
    expect(order.lastIndexOf('viewing')).toBeLessThan(firstIndex.post);
  });

  it('the viewing phase is exactly the Viewing Report step', () => {
    expect(stepsInPhase('viewing')).toEqual([8]);
    expect(SECTIONS[7].slug).toBe('viewing');
  });

  it('Report 2 generation sits in the post-viewing phase', () => {
    const generate = SECTIONS.find((s) => s.slug === 'generate');
    expect(generate?.phase).toBe('post');
  });

  it('WIZARD_PHASES covers every section phase', () => {
    const keys = new Set(WIZARD_PHASES.map((p) => p.key));
    expect(SECTIONS.every((s) => keys.has(s.phase))).toBe(true);
  });
});
