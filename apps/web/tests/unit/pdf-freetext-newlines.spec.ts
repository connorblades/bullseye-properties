import { describe, expect, it } from 'vitest';
import { renderDealReportToBuffer } from '@/server/pdf/render';
import { buildReportData } from '@/server/pdf/report-data';
import { emptyDeal } from '@/lib/deal-store';

/**
 * Regression: a literal '\n' inside a <Text> crashes this @react-pdf build
 * (unitsPerEm). Beyond the AI narratives, several partner-typed free-text fields
 * are rendered in the report - viewing notes / assessment / summary, auction
 * special conditions + restrictive covenants, growth-driver justifications, and
 * the partner bio. All must go through Prose (never a raw <Text>/<Body>), so a
 * partner writing multi-paragraph text does not crash the render.
 */
describe('report renders partner free-text fields with newlines', () => {
  it('does not crash on newlines in any free-text field', async () => {
    const deal = emptyDeal('d-ftn', { address: '1 Test St', source: 'auction' });
    const multi = 'First line.\nSecond line.\n\nA new paragraph after a blank line.';
    deal.viewing.notes = multi;
    deal.viewing.assessment = multi;
    deal.viewing.summary = multi;
    deal.auction.isAuction = true;
    deal.auction.specialConditions = multi;
    deal.auction.restrictiveCovenants = multi;
    deal.growth.drivers = [{ id: 'g1', title: 'Employer', justification: multi }];

    const data = buildReportData({
      deal,
      reference: 'BSE-FTN',
      generatedOn: '02/07/2026',
      partner: { displayName: 'Connor Blades', shortBio: multi },
      narratives: {},
    });

    const buf = await renderDealReportToBuffer(data);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10_000);
  }, 30_000);
});
