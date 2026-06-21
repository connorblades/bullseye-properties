import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DISCLOSURE_FOOTER } from '@/server/pdf/tokens';

/**
 * AI-disclosure footer enforcement (M3-T9 / AC-07).
 *
 * @react-pdf embeds text as subset-font glyph codes, so the footer can't be
 * grepped out of the compiled PDF without a full font/ToUnicode parser (that is
 * Connor's manual text-extraction acceptance step). We instead lock the two
 * guarantees that make "footer on every page" true by construction:
 *   1. The footer wording is the exact AC-07 string.
 *   2. The DisclosureFooter is a `fixed` element (repeats on every printed page
 *      of a Page) and is mounted on BOTH the cover and the content Page.
 */

const SRC = path.resolve(__dirname, '../../src/server/pdf');

describe('disclosure footer', () => {
  it('matches the verbatim AC-07 wording', () => {
    expect(DISCLOSURE_FOOTER).toBe(
      'This report includes narrative sections drafted with AI assistance and reviewed by your accredited partner. ' +
        "Comparable evidence and financial calculations are sourced from the partner's own data inputs."
    );
  });

  it('is a fixed element rendering the disclosure text', () => {
    const components = readFileSync(path.join(SRC, 'components.tsx'), 'utf8');
    // The DisclosureFooter View is marked `fixed` and renders DISCLOSURE_FOOTER.
    const footerBlock = components.slice(components.indexOf('function DisclosureFooter'));
    expect(footerBlock).toContain('fixed');
    expect(footerBlock).toContain('DISCLOSURE_FOOTER');
  });

  it('is mounted on every Page (cover + content)', () => {
    const dealReport = readFileSync(path.join(SRC, 'DealReport.tsx'), 'utf8');
    const mounts = dealReport.match(/<DisclosureFooter/g) ?? [];
    // One on the cover Page, one on the content Page.
    expect(mounts.length).toBeGreaterThanOrEqual(2);
  });
});
