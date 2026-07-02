import { describe, expect, it } from 'vitest';
import { stripInlineMarkdown } from '@/server/pdf/components';

describe('stripInlineMarkdown', () => {
  it('strips **bold** and __bold__ markers, keeping the text', () => {
    expect(stripInlineMarkdown('**To complete this section:**')).toBe('To complete this section:');
    expect(stripInlineMarkdown('sits in **Flood Zone 3 (High Risk)**, near')).toBe('sits in Flood Zone 3 (High Risk), near');
    expect(stripInlineMarkdown('__important__ note')).toBe('important note');
  });

  it('strips inline code backticks and heading/quote markers', () => {
    expect(stripInlineMarkdown('the `EPC` rating')).toBe('the EPC rating');
    expect(stripInlineMarkdown('## Heading text')).toBe('Heading text');
    expect(stripInlineMarkdown('> quoted line')).toBe('quoted line');
  });

  it('removes any stray unpaired bold markers', () => {
    expect(stripInlineMarkdown('a stray ** marker here')).toBe('a stray  marker here');
  });

  it('leaves clean text untouched', () => {
    expect(stripInlineMarkdown('Plain sentence with no markup.')).toBe('Plain sentence with no markup.');
  });
});
