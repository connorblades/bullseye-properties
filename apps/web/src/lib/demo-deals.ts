/**
 * Browning Street demo deal — canonical sample data used as a sandbox for
 * walking the 15-stage wizard end-to-end with realistic content. Served from
 * /admin/seed after Connor signs in.
 *
 * Update notes for future contributors: when the Deal schema changes, this
 * file must change with it. Run `pnpm typecheck` to catch drift.
 */

import type { Amenity, AmenityCategory, CrimeStats, Deal, TravelMode } from './deal-store';

function amenity(category: AmenityCategory, name: string, distanceText: string, travelMinutes: number, mode: TravelMode): Amenity {
  return {
    id: 'a-' + Math.random().toString(36).slice(2, 8),
    category, name, distanceText, travelMinutes, mode,
  };
}

const browningStreetAmenities: Amenity[] = [
  amenity('groceries', 'Tesco Express, Clipstone Road West', '0.3 mi', 5, 'walk'),
  amenity('recreation', 'Hetts Lane Park', '0.2 mi', 4, 'walk'),
  amenity('dining', 'The Crown public house', '0.4 mi', 6, 'walk'),
  amenity('education', 'Forest Town Primary School', '0.4 mi', 8, 'walk'),
  amenity('dining', 'Forest Town Welfare Recreation Ground', '0.3 mi', 5, 'walk'),
  amenity('healthcare', "King's Mill Hospital", '1.8 mi', 5, 'drive'),
  amenity('transport', 'Mansfield Train Station (Robin Hood Line)', '1.4 mi', 5, 'drive'),
  amenity('groceries', 'Tesco Superstore Mansfield', '1.1 mi', 4, 'drive'),
  amenity('education', "Queen Elizabeth's Academy (sixth form)", '0.9 mi', 4, 'drive'),
  amenity('tourism', 'Mansfield Town Centre (shops, leisure, market)', '1.5 mi', 4, 'drive'),
  amenity('employment', 'Toyota Manufacturing UK (BBN1 plant)', '6.2 mi', 12, 'drive'),
  amenity('tourism', 'Sherwood Forest visitor centre', '7.8 mi', 14, 'drive'),
  amenity('transport', 'A60 access (M1 J29 corridor)', '0.4 mi', 2, 'drive'),
];

const browningStreetCrime: CrimeStats = {
  total12mo: 410,
  per1000: '34.2',
  districtAvg: '38.1',
  comparison: 'lower',
  comparisonPct: '10% lower than district average',
  breakdown: [
    { category: 'Anti-social behaviour', count: 145 },
    { category: 'Violence and sexual offences', count: 96 },
    { category: 'Public order', count: 50 },
    { category: 'Other theft', count: 42 },
    { category: 'Vehicle crime', count: 35 },
    { category: 'Burglary', count: 22 },
    { category: 'Criminal damage and arson', count: 15 },
    { category: 'Drugs', count: 5 },
  ],
};

/**
 * Returns the Browning Street demo deal data ready to seed.
 * The `address`, `source`, and `progress` fields go into table columns;
 * everything else goes into the `inputs` jsonb when persisted.
 */
export const browningStreetSeed: Partial<Deal> = {
  address: '6, Browning Street, Mansfield, NG18 5PH',
  client: 'James W. (London)',
  source: 'estate-agent',
  progress: 12,
  criteria: {
    budget: '£350,000',
    areas: 'Mansfield, Worksop, Doncaster',
    propertyType: 'Semi-detached or terrace, 2-3 bed',
    targetYield: '7%+',
    refurbTolerance: 'Light: paint, carpets, basic kitchen',
    epcRequirement: 'C or upgradable to C',
    timeline: 'Complete within 4 months',
  },
  location: {
    contextImages: [
      { id: 'c-bsd1', caption: 'Town centre / regeneration' },
      { id: 'c-bsd2', caption: 'Transport hub' },
      { id: 'c-bsd3', caption: 'Major employer' },
    ],
    amenities: browningStreetAmenities,
    crime: browningStreetCrime,
  },
  property: {
    type: 'Semi-detached',
    bedrooms: '3',
    bathrooms: '1',
    floorArea: '780',
    plotSize: '2200',
    parking: 'Off-street, single',
    yearBuilt: 'c. 1950',
    heating: 'Gas combi (2021)',
    askingPrice: '135000',
    documents: [],
  },
  salesComps: [
    { id: 'c-bsd1', address: '4 Browning Street', detail: 'Sold 2025-08 - 740 sqft', value: '£128,000' },
    { id: 'c-bsd2', address: '12 Browning Street', detail: 'Sold 2025-03 - 760 sqft', value: '£141,000' },
    { id: 'c-bsd3', address: '8 Park Road', detail: 'Sold 2025-06 - 720 sqft', value: '£132,000' },
  ],
  rentalComps: [
    { id: 'r-bsd1', address: '5 Browning Street', detail: 'Listed 2025-09 - 2-bed', value: '£795 / mo' },
    { id: 'r-bsd2', address: '10 Park Road', detail: 'Listed 2025-07 - 3-bed refurbed', value: '£825 / mo' },
    { id: 'r-bsd3', address: '22 Mansfield Road', detail: 'Listed 2025-08 - 3-bed', value: '£775 / mo' },
  ],
  viewing: {
    roof: 'Good', damp: 'Good', windows: 'OK', heating: 'Good', electrics: 'Good', structure: 'Good',
    notes: 'Roof concrete tiles, good order. Combi 2021, electrics certified 2019. UPVC windows 12-15 years old, functional but ageing. Light cosmetic refurb only.',
    photos: [],
  },
  growth: {
    capitalGrowthPct: '3.0', rentalGrowthPct: '2.0', mortgageType: 'interest-only',
    ltvPct: '75', mortgageRatePct: '5.8', holdYears: '10', refinanceYears: '2,5',
    drivers: [
      { id: 'g-bsd1', title: "King's Mill Hospital", justification: '1.8 miles. 4,000+ NHS staff. £100m+ expansion confirmed 2025. Consistent rental demand from medical workforce.' },
      { id: 'g-bsd2', title: 'Mansfield town centre regeneration', justification: '£18m masterplan confirmed 2024. High street, public realm, Sherwood Discovery Centre. NG18 desirability uplift over 5-10 years.' },
      { id: 'g-bsd3', title: 'Robin Hood Line connectivity', justification: 'Direct 28-min train to Nottingham. Half-hourly service proposals from 2027 broaden tenant pool to Nottingham professionals.' },
      { id: 'g-bsd4', title: 'School catchment ratings', justification: 'Forest Town Primary (Good, 2024) at 0.4 mi. Queen Elizabeth Academy (Good, 2023) at 0.9 mi. Catchment premium 5-8%.' },
    ],
  },
  refurb: {
    needed: true,
    items: [
      { id: 'r-i1', name: 'Paint and decoration', cost: '1400' },
      { id: 'r-i2', name: 'Carpets', cost: '900' },
      { id: 'r-i3', name: 'Kitchen refresh', cost: '1800' },
      { id: 'r-i4', name: 'Bathroom touch-up', cost: '400' },
    ],
    contingencyPct: '10',
    weeks: '3',
  },
  financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '2270' },
  offer: {
    recommended: '112500',
    strategy: 'Open at £108,000 anchoring on £4,950 refurb and EPC D rating. Settle £110-115k. Vendor motivated (downsizing, 89 days on market).',
  },
};
