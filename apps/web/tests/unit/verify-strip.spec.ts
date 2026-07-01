import { describe, expect, it } from 'vitest';
import { stripVerifyMarkers } from '@/server/pdf/report-data';

describe('stripVerifyMarkers', () => {
  it('removes an inline [VERIFY: ...] marker', () => {
    expect(stripVerifyMarkers('Strong area [VERIFY: confirm transport] with good schools.')).toBe(
      'Strong area with good schools.',
    );
  });

  it('removes a multi-line VERIFY block', () => {
    const t = 'Intro paragraph.\n\n[VERIFY: line one\nline two of the note]\n\nClosing paragraph.';
    const out = stripVerifyMarkers(t);
    expect(out).not.toContain('VERIFY');
    expect(out).toContain('Intro paragraph.');
    expect(out).toContain('Closing paragraph.');
  });

  it('collapses whitespace left behind and trims', () => {
    expect(stripVerifyMarkers('The offer [VERIFY: x]  reflects comps.')).toBe('The offer reflects comps.');
  });

  it('leaves clean text untouched', () => {
    expect(stripVerifyMarkers('No markers here.')).toBe('No markers here.');
  });
});
