import { describe, expect, it } from 'vitest';
import { renderOutlinePackToBuffer } from '@/server/pdf/render';
import { buildOutline } from '@/lib/outline';
import { emptyDeal } from '@/lib/deal-store';

/**
 * Smoke test for the public Outline pack PDF. This also guards the embedded
 * (base64 data-URI) font path: if Noto fails to register, @react-pdf throws
 * `unitsPerEm undefined` and this render rejects - which is exactly the Vercel
 * serverless failure that broke the /o/[id]/pdf route.
 */
function deal() {
  return emptyDeal('d-out', {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    client: 'A. Investor',
    criteria: { budget: '£130,000', areas: 'Mansfield', propertyType: 'Semi-detached', targetYield: '7%+', refurbTolerance: '', epcRequirement: '', timeline: '' },
    property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '120000', documents: [] },
    financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '1800' },
    location: {
      contextImages: [{ id: 'c1', caption: 'High street', imageData: TINY_PNG }],
      amenities: [],
      mapImage: TINY_PNG,
    },
  });
}

// 1x1 transparent PNG as a data URI - exercises the Image render path without a fetch.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAD0lEQVR4nGM4gQQYiOMAAM9hJYGWbiP1AAAAAElFTkSuQmCC';

describe('renderOutlinePackToBuffer', () => {
  it('renders a valid 1-page PDF using the embedded font', async () => {
    const buf = await renderOutlinePackToBuffer({
      data: buildOutline(deal()),
      partner: { displayName: 'Connor Blades', accreditationNo: 'BSE-CB-001', accreditedAt: '2025-01-10', amlRegistration: 'AML123', icoRegistration: 'ICO456', piPolicy: 'PI789', contactEmail: 'connor@bullseyeproperties.co.uk', contactPhone: '07000 000000', shortBio: 'Accredited partner.' },
      preparedFor: 'A. Investor',
      generatedOn: '23/06/2026',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5_000);
  });
});
