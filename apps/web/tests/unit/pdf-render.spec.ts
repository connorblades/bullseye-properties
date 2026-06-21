import { describe, expect, it } from 'vitest';
import { renderDealReportToBuffer } from '@/server/pdf/render';
import { buildReportData } from '@/server/pdf/report-data';
import { emptyDeal } from '@/lib/deal-store';

/**
 * Exercises all 16 sections incl. the conditional ones (auction, refurb) and the
 * data-heavy paths (crime chart, EPC, HPI-adjusted comps, growth drivers, equity
 * projection). No remote URLs or uploaded images, so no asset fetching.
 */
function sampleData() {
  const deal = emptyDeal('d-browning', {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    postcode: 'NG18 5QH',
    source: 'auction',
    criteria: { budget: '£130,000', areas: 'Mansfield', propertyType: 'Semi, 3-bed', targetYield: '7%+', refurbTolerance: 'Light', epcRequirement: 'C', timeline: '4 months' },
    property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '2200', parking: 'Off-street', yearBuilt: 'c. 1950', heating: 'Gas combi', askingPrice: '120000', documents: [] },
    financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '1800' },
    growth: { capitalGrowthPct: '3.0', rentalGrowthPct: '2.0', mortgageType: 'interest-only', ltvPct: '75', mortgageRatePct: '5.8', holdYears: '10', refinanceYears: '2,5', drivers: [
      { id: 'g1', title: "King's Mill Hospital", justification: 'Major employer 2mi away supporting rental demand.' },
      { id: 'g2', title: 'HS2 / transport', justification: 'Improved connectivity to Nottingham.' },
    ] },
    refurb: { needed: true, items: [{ id: 'i1', name: 'Damp proofing', cost: '2500' }, { id: 'i2', name: 'Redecoration', cost: '1400' }], contingencyPct: '10', weeks: '4' },
    auction: { isAuction: true, buyerFees: '2400', specialConditions: 'Buyer pays vendor legal costs.', restrictiveCovenants: 'None noted' },
    viewing: { roof: 'OK', damp: 'Issue', windows: 'Good', heating: 'Good', electrics: 'OK', structure: 'Good', notes: 'Minor damp in rear bedroom.', photos: [] },
    salesComps: [
      { id: 's1', address: '8 Browning Street', detail: 'Sold 2025-08', value: '£128,000' },
      { id: 's2', address: '21 Tennyson Ave', detail: 'Sold 2025-05', value: '£124,500' },
    ],
    rentalComps: [{ id: 'r1', address: '15 Browning Street', detail: 'Listed 2025-09', value: '£795 / month' }],
    offer: { recommended: '112500', strategy: 'Anchor at 108k citing damp; settle 110-113k.' },
    location: {
      contextImages: [], amenities: [
        { id: 'a1', category: 'transport', name: 'Mansfield Station', distanceText: '0.8mi', travelMinutes: 16, mode: 'walk' },
        { id: 'a2', category: 'groceries', name: 'Tesco', distanceText: '0.4mi', travelMinutes: 8, mode: 'walk' },
      ],
      crime: { total12mo: 420, per1000: '52', districtAvg: '60', comparison: 'lower', comparisonPct: '13', breakdown: [
        { category: 'Anti-social behaviour', count: 120 }, { category: 'Violence', count: 90 }, { category: 'Burglary', count: 40 },
      ] },
    },
    publicData: {
      postcode: 'NG18 5QH', district: 'Mansfield', status: {},
      flood: { band: 1, riskLabel: 'Flood Zone 1 - Low risk', riversAndSea: 'Very low', surfaceWater: 'Low', hasActiveWarning: false, source: 'EA' },
      epc: { currentRating: 'D', currentScore: 58, potentialRating: 'B', potentialScore: 84, floorAreaM2: 72, mainHeating: 'Gas boiler' },
      hpi: { district: 'Mansfield', districtCode: 'E07', latestMonth: '2025-12', latestIndex: 150, latestAvgPrice: 165000, cagr10yrPct: 4.2, series: [{ month: '2025-05', index: 144 }, { month: '2025-08', index: 147 }, { month: '2025-12', index: 150 }] },
      demographics: { imdDecile: 4, ward: 'Mansfield Central', constituency: 'Mansfield' },
      councilTax: { band: 'A', source: 'VOA' },
    },
    narratives: {
      'why-this-fits': 'This property matches the brief on yield and location.',
      location: 'Mansfield offers strong rental demand near key employers.',
      condition: 'Sound structurally; address the rear-bedroom damp early.',
      'offer-rationale': 'The recommended offer reflects comparable evidence and the damp works.',
      'next-steps': 'Review the pack.\nConfirm finance.\nInstruct a solicitor.\nAuthorise the offer.',
    },
  });
  return buildReportData({
    deal,
    reference: 'BSE-CB-001-001',
    preparedFor: 'A. Investor',
    generatedOn: '21/06/2026',
    partner: { displayName: 'Connor Blades', accreditationNo: 'BSE-CB-001', accreditedAt: '2025-01-10', amlRegistration: 'AML123', icoRegistration: 'ICO456', piPolicy: 'PI789', contactEmail: 'connor@bullseyeproperties.co.uk', contactPhone: '07000 000000', shortBio: 'Accredited sourcing partner for the East Midlands.' },
  });
}

describe('renderDealReportToBuffer', () => {
  it('renders all 16 sections to a valid, multi-page PDF', async () => {
    const buf = await renderDealReportToBuffer(sampleData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10_000);

    // Multi-page: cover + section pages.
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount).toBeGreaterThanOrEqual(5);
  }, 30_000);
});
