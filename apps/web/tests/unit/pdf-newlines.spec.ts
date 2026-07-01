import { describe, expect, it } from 'vitest';
import { renderDealReportToBuffer } from '@/server/pdf/render';
import { buildReportData } from '@/server/pdf/report-data';
import { emptyDeal } from '@/lib/deal-store';

/**
 * Regression: a literal '\n' inside a <Text> crashes this @react-pdf build
 * ("Cannot read properties of undefined (reading 'unitsPerEm')"). Real AI
 * narratives contain paragraph breaks and soft newlines, so the report must
 * render them without ever passing a newline to a Text node (see Prose +
 * paragraphs()). Every narrative below has both '\n\n' and a bare '\n'.
 */
describe('report renders multi-paragraph narratives with newlines', () => {
  it('does not crash on newlines in any narrative', async () => {
    const deal = emptyDeal('d-nl', {
      address: '1 Trent Boulevard, West Bridgford, NG2 7AB',
      postcode: 'NG2 7AB',
      source: 'direct',
      property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '', parking: '', yearBuilt: '', heating: 'Gas combi', askingPrice: '150000', documents: [] },
      financials: { purchasePrice: '140000', monthlyRent: '900', annualCosts: '1800' },
      offer: { recommended: '135000', strategy: 'Anchor low.' },
    });

    const nl = 'First paragraph with a soft\nline break inside it.\n\nSecond paragraph after a blank line.\n\n[VERIFY: confirm the figure.]';
    const data = buildReportData({
      deal,
      reference: 'BSE-NL-001',
      preparedFor: undefined,
      generatedOn: '01/07/2026',
      partner: { displayName: 'Connor Blades' },
      narratives: {
        'why-this-fits': nl,
        location: nl,
        condition: nl,
        'offer-rationale': nl,
        'next-steps': 'Step one.\nStep two.\nStep three.',
      },
    });

    const buf = await renderDealReportToBuffer(data);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10_000);
  });
});
