import { describe, expect, it } from 'vitest';
import { buildGenerationRow, computeEditsDiff, decodeRawResponse } from '@/server/claude/audit';

describe('computeEditsDiff', () => {
  it('returns empty string when the partner made no edits', () => {
    expect(computeEditsDiff('same text\nline two', 'same text\nline two')).toBe('');
  });

  it('shows removed and added lines when edited', () => {
    const diff = computeEditsDiff('the rent is 800\nstrong area', 'the rent is 825\nstrong area');
    expect(diff).toContain('- the rent is 800');
    expect(diff).toContain('+ the rent is 825');
    expect(diff).not.toContain('strong area\n+ strong area'); // unchanged line not duplicated
  });
});

describe('buildGenerationRow (M3-T5 append-only audit)', () => {
  const base = {
    tenantId: 't-1',
    dealId: 'd-1',
    dealReportVersionId: 'drv-1',
    sectionKey: 'why-this-fits',
    modelId: 'claude-sonnet-4-6',
    promptVersionHash: 'abcd1234abcd1234',
    inputTokens: 1200,
    outputTokens: 240,
    generatedBy: '00000000-0000-0000-0000-000000000001',
  };

  it('gzips the raw response so it round-trips, and maps all fields', () => {
    const raw = 'The property fits the brief. [VERIFY: confirm EPC]';
    const row = buildGenerationRow({ ...base, rawResponse: raw, editedText: raw });

    expect(row.id).toMatch(/^cg-/);
    expect(row.tenantId).toBe('t-1');
    expect(row.sectionKey).toBe('why-this-fits');
    expect(row.modelId).toBe('claude-sonnet-4-6');
    expect(row.inputTokens).toBe(1200);
    expect(Buffer.isBuffer(row.rawResponse)).toBe(true);
    expect(decodeRawResponse(row.rawResponse)).toBe(raw);
  });

  it('stores null diff when unedited and a real diff when edited', () => {
    const raw = 'Rent is 800 pcm.';
    const unedited = buildGenerationRow({ ...base, rawResponse: raw, editedText: raw });
    expect(unedited.partnerEditsDiff).toBeNull();

    const edited = buildGenerationRow({ ...base, rawResponse: raw, editedText: 'Rent is 825 pcm.' });
    expect(edited.partnerEditsDiff).toContain('- Rent is 800 pcm.');
    expect(edited.partnerEditsDiff).toContain('+ Rent is 825 pcm.');
  });
});
