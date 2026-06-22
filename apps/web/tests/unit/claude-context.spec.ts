import { describe, expect, it } from 'vitest';
import { buildDealContext } from '@/server/claude/context';
import { emptyDeal } from '@/lib/deal-store';

describe('buildDealContext - open-data additions', () => {
  it('includes nearest river-level station and corporate owners when present', () => {
    const deal = emptyDeal('d', {
      address: '12 Browning Street, Mansfield, NG18 5QH',
      publicData: {
        postcode: 'NG18 5QH',
        status: {},
        riverLevels: {
          source: 'Environment Agency real-time flood-monitoring',
          stations: [{ label: 'Mansfield Gauge', riverName: 'River Maun', town: 'Mansfield', distanceKm: 1.2 }],
        },
        landOwnership: {
          titles: [
            { titleNumber: 'NG1', dataset: 'ccod', tenure: 'Freehold', proprietors: [{ name: 'ACME PROPERTIES LTD', companyRegNo: '01234567' }] },
          ],
        },
      },
    });
    const ctx = buildDealContext(deal);
    expect(ctx).toContain('River Maun');
    expect(ctx).toContain('Nearest river-level station');
    expect(ctx).toContain('ACME PROPERTIES LTD');
    expect(ctx).toContain('Corporate owners at postcode');
  });

  it('omits those lines cleanly when the data is absent', () => {
    const ctx = buildDealContext(emptyDeal('d', { address: '1 A St, NG1 1AA' }));
    expect(ctx).not.toContain('Nearest river-level station');
    expect(ctx).not.toContain('Corporate owners at postcode');
  });
});
