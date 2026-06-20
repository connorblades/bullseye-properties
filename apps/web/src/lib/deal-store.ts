'use client';

/**
 * Wizard state store - localStorage placeholder for M1.
 *
 * This is a deliberate temporary implementation. Once Supabase is provisioned
 * (M0-T2) and Server Actions land (M1 follow-up), every export here gets a
 * server-backed twin and the `'use client'` directive moves out. The Deal type
 * and function signatures are the public contract: they must not change.
 *
 * The `Deal` shape mirrors `deals.inputs` (jsonb) in the database schema, so
 * the migration path is "swap implementation, keep type".
 */

import { useState, useEffect, useCallback } from 'react';

export type StageRating = 'Good' | 'OK' | 'Issue' | '';
export type MortgageType = 'cash' | 'interest-only' | 'repayment';

export type Comp = {
  id: string;
  address: string;
  detail: string;
  value: string;
};

export type RefurbItem = {
  id: string;
  name: string;
  cost: string;
};

export type GrowthDriver = {
  id: string;
  title: string;
  justification: string;
  imageData?: string;
};

export type AmenityCategory =
  | 'groceries' | 'transport' | 'healthcare' | 'education'
  | 'recreation' | 'tourism' | 'dining' | 'employment';
export type TravelMode = 'walk' | 'drive' | 'transit';
export type Amenity = {
  id: string;
  category: AmenityCategory;
  name: string;
  distanceText: string;
  travelMinutes: number;
  mode: TravelMode;
};

export type CrimeStats = {
  total12mo: number;
  per1000: string;
  districtAvg: string;
  comparison: 'lower' | 'similar' | 'higher';
  comparisonPct: string;
  breakdown: { category: string; count: number }[];
};

export type DocumentKind = 'floor-plan' | 'title-plan' | 'epc' | 'land-registry' | 'other';
export type PropertyDocument = {
  id: string;
  kind: DocumentKind;
  filename: string;
  imageData?: string;
  source: 'uploaded' | 'pulled';
};

export type Deal = {
  id: string;
  createdAt: string;
  address: string;
  client: string;
  source: 'estate-agent' | 'auction' | 'direct-to-vendor';
  progress: number;
  delivered: boolean;

  criteria: {
    budget: string;
    areas: string;
    propertyType: string;
    targetYield: string;
    refurbTolerance: string;
    epcRequirement: string;
    timeline: string;
  };

  location: {
    mapImage?: string;
    contextImages: { id: string; caption: string; imageData?: string }[];
    amenities: Amenity[];
    crime?: CrimeStats;
  };

  property: {
    type: string;
    bedrooms: string;
    bathrooms: string;
    floorArea: string;
    plotSize: string;
    parking: string;
    yearBuilt: string;
    heating: string;
    askingPrice: string;
    documents: PropertyDocument[];
  };

  salesComps: Comp[];
  rentalComps: Comp[];

  auction: {
    isAuction: boolean;
    buyerFees: string;
    specialConditions: string;
    restrictiveCovenants: string;
  };

  viewing: {
    roof: StageRating;
    damp: StageRating;
    windows: StageRating;
    heating: StageRating;
    electrics: StageRating;
    structure: StageRating;
    notes: string;
    photos: string[];
  };

  growth: {
    capitalGrowthPct: string;
    rentalGrowthPct: string;
    mortgageType: MortgageType;
    ltvPct: string;
    mortgageRatePct: string;
    holdYears: string;
    refinanceYears: string;
    drivers: GrowthDriver[];
  };

  refurb: {
    needed: boolean;
    items: RefurbItem[];
    contingencyPct: string;
    weeks: string;
  };

  financials: {
    purchasePrice: string;
    monthlyRent: string;
    annualCosts: string;
  };

  offer: {
    recommended: string;
    strategy: string;
  };
};

const KEY_PREFIX = 'bullseye:deal:';
const INDEX_KEY = 'bullseye:deals';
const SEED_FLAG = 'bullseye:seeded:v3';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function defaultGrowthDrivers(): GrowthDriver[] {
  return [1, 2, 3, 4].map(() => ({
    id: 'g-' + randomSuffix(),
    title: '',
    justification: '',
  }));
}

function defaultContextImages() {
  return [
    { id: 'c-' + randomSuffix(), caption: 'Town centre / regeneration' },
    { id: 'c-' + randomSuffix(), caption: 'Transport hub' },
    { id: 'c-' + randomSuffix(), caption: 'Major employer' },
  ];
}

export function emptyDeal(id: string, initial: Partial<Deal> = {}): Deal {
  return {
    id,
    createdAt: new Date().toISOString(),
    address: '',
    client: '',
    source: 'estate-agent',
    progress: 1,
    delivered: false,
    criteria: { budget: '', areas: '', propertyType: '', targetYield: '', refurbTolerance: '', epcRequirement: '', timeline: '' },
    location: { contextImages: defaultContextImages(), amenities: [] },
    property: { type: '', bedrooms: '', bathrooms: '', floorArea: '', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '', documents: [] },
    salesComps: [],
    rentalComps: [],
    auction: { isAuction: false, buyerFees: '', specialConditions: '', restrictiveCovenants: '' },
    viewing: { roof: '', damp: '', windows: '', heating: '', electrics: '', structure: '', notes: '', photos: [] },
    growth: {
      capitalGrowthPct: '3.0',
      rentalGrowthPct: '2.0',
      mortgageType: 'interest-only',
      ltvPct: '75',
      mortgageRatePct: '5.8',
      holdYears: '10',
      refinanceYears: '2,5',
      drivers: defaultGrowthDrivers(),
    },
    refurb: { needed: false, items: [], contingencyPct: '10', weeks: '' },
    financials: { purchasePrice: '', monthlyRent: '', annualCosts: '' },
    offer: { recommended: '', strategy: '' },
    ...initial,
  };
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function listDealIds(): string[] {
  if (!isBrowser()) return [];
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
  catch { return []; }
}

export function listDeals(): Deal[] {
  return listDealIds().map(getDeal).filter(Boolean) as Deal[];
}

export function getDeal(id: string): Deal | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(KEY_PREFIX + id);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Deal;
    if (!parsed.location) parsed.location = { contextImages: defaultContextImages(), amenities: [] };
    if (!parsed.location.contextImages) parsed.location.contextImages = defaultContextImages();
    if (!parsed.location.amenities) parsed.location.amenities = [];
    if (!parsed.property.documents) parsed.property.documents = [];
    if (!parsed.growth) {
      parsed.growth = {
        capitalGrowthPct: '3.0', rentalGrowthPct: '2.0',
        mortgageType: 'interest-only', ltvPct: '75', mortgageRatePct: '5.8',
        holdYears: '10', refinanceYears: '2,5', drivers: defaultGrowthDrivers(),
      };
    }
    if (parsed.viewing && !Array.isArray((parsed.viewing as unknown as { photos?: string[] }).photos)) {
      (parsed.viewing as unknown as { photos: string[] }).photos = [];
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDeal(deal: Deal): void {
  if (!isBrowser()) return;
  try { localStorage.setItem(KEY_PREFIX + deal.id, JSON.stringify(deal)); }
  catch (e) {
    console.warn('localStorage quota exceeded; consider removing large images.', e);
    return;
  }
  const ids = listDealIds();
  if (!ids.includes(deal.id)) {
    ids.push(deal.id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  }
}

export function updateDeal(id: string, patch: Partial<Deal>): Deal | null {
  const deal = getDeal(id);
  if (!deal) return null;
  const updated = { ...deal, ...patch };
  saveDeal(updated);
  return updated;
}

export function setStageProgress(id: string, stage: number): void {
  const deal = getDeal(id);
  if (!deal) return;
  if (stage > deal.progress) saveDeal({ ...deal, progress: stage });
}

export function newId(): string { return 'd-' + randomSuffix(); }

export function deleteAll(): void {
  if (!isBrowser()) return;
  listDealIds().forEach((id) => localStorage.removeItem(KEY_PREFIX + id));
  localStorage.removeItem(INDEX_KEY);
  localStorage.removeItem(SEED_FLAG);
}

function browningStreetAmenities(): Amenity[] {
  const a = (category: AmenityCategory, name: string, distanceText: string, travelMinutes: number, mode: TravelMode): Amenity => ({
    id: 'a-' + randomSuffix(),
    category, name, distanceText, travelMinutes, mode,
  });
  return [
    a('groceries', 'Tesco Express, Clipstone Road West', '0.3 mi', 5, 'walk'),
    a('recreation', 'Hetts Lane Park', '0.2 mi', 4, 'walk'),
    a('dining', 'The Crown public house', '0.4 mi', 6, 'walk'),
    a('education', 'Forest Town Primary School', '0.4 mi', 8, 'walk'),
    a('dining', 'Forest Town Welfare Recreation Ground', '0.3 mi', 5, 'walk'),
    a('healthcare', "King's Mill Hospital", '1.8 mi', 5, 'drive'),
    a('transport', 'Mansfield Train Station (Robin Hood Line)', '1.4 mi', 5, 'drive'),
    a('groceries', 'Tesco Superstore Mansfield', '1.1 mi', 4, 'drive'),
    a('education', "Queen Elizabeth's Academy (sixth form)", '0.9 mi', 4, 'drive'),
    a('tourism', 'Mansfield Town Centre (shops, leisure, market)', '1.5 mi', 4, 'drive'),
    a('employment', 'Toyota Manufacturing UK (BBN1 plant)', '6.2 mi', 12, 'drive'),
    a('tourism', 'Sherwood Forest visitor centre', '7.8 mi', 14, 'drive'),
    a('transport', 'A60 access (M1 J29 corridor)', '0.4 mi', 2, 'drive'),
  ];
}

function browningStreetCrime(): CrimeStats {
  return {
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
}

export function seedDemoDealsIfEmpty(): void {
  if (!isBrowser()) return;
  if (localStorage.getItem(SEED_FLAG)) return;
  if (listDealIds().length > 0) {
    localStorage.setItem(SEED_FLAG, '1');
    return;
  }

  const browning = emptyDeal('d-demo1', {
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
      contextImages: defaultContextImages(),
      amenities: browningStreetAmenities(),
      crime: browningStreetCrime(),
    },
    property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '2200', parking: 'Off-street, single', yearBuilt: 'c. 1950', heating: 'Gas combi (2021)', askingPrice: '135000', documents: [] },
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
  });

  const ely = emptyDeal('d-demo2', {
    address: '18, Ely Road, Doncaster, DN2 4HJ',
    client: 'Priya S. (Surrey)',
    source: 'auction',
    progress: 8,
    criteria: { budget: '£180,000', areas: 'Doncaster, Rotherham', propertyType: 'Terrace, 2 bed', targetYield: '8%+', refurbTolerance: 'Medium: kitchen, bathroom', epcRequirement: 'D minimum', timeline: 'Flexible' },
    auction: { isAuction: true, buyerFees: '2400', specialConditions: '2 flagged: extension overage; indemnity required', restrictiveCovenants: 'None' },
  });

  const duchess = emptyDeal('d-demo3', {
    address: '6, Duchess Street, Whitwell, S80 4TL',
    client: 'David and Sarah T.',
    source: 'direct-to-vendor',
    progress: 15,
    delivered: true,
    property: { type: 'Terrace', bedrooms: '2', bathrooms: '1', floorArea: '650', plotSize: '1400', parking: 'On-street', yearBuilt: 'c. 1900', heating: 'Gas combi (2018)', askingPrice: '95000', documents: [] },
    financials: { purchasePrice: '82000', monthlyRent: '675', annualCosts: '1800' },
    offer: { recommended: '82000', strategy: 'Anchored on Land Registry median, secured 13% below asking.' },
  });

  saveDeal(browning);
  saveDeal(ely);
  saveDeal(duchess);
  localStorage.setItem(SEED_FLAG, '1');
}

export function useDeal(id: string) {
  const [deal, setDealState] = useState<Deal | null>(null);

  useEffect(() => { setDealState(getDeal(id)); }, [id]);

  const update = useCallback(
    (patch: Partial<Deal>) => {
      const updated = updateDeal(id, patch);
      if (updated) setDealState(updated);
    },
    [id]
  );

  return [deal, update] as const;
}

export type ComputedFinancials = {
  purchasePrice: number;
  annualRent: number;
  annualCosts: number;
  grossYield: number;
  netYield: number;
  totalAcquisition: number;
  refurbCost: number;
  refurbWithContingency: number;
};

export function computeFinancials(deal: Deal): ComputedFinancials {
  const purchasePrice = parseFloat(deal.financials.purchasePrice.replace(/[^0-9.]/g, '')) || 0;
  const monthlyRent = parseFloat(deal.financials.monthlyRent.replace(/[^0-9.]/g, '')) || 0;
  const annualCosts = parseFloat(deal.financials.annualCosts.replace(/[^0-9.]/g, '')) || 0;
  const annualRent = monthlyRent * 12;

  const refurbItemsTotal = deal.refurb.items.reduce((sum, i) => {
    const v = parseFloat(i.cost.replace(/[^0-9.]/g, '')) || 0;
    return sum + v;
  }, 0);
  const contingencyPct = parseFloat(deal.refurb.contingencyPct) || 0;
  const refurbWithContingency = refurbItemsTotal * (1 + contingencyPct / 100);

  const sourcingFee = 3000;
  const totalAcquisition = purchasePrice + refurbWithContingency + sourcingFee;

  const grossYield = purchasePrice > 0 ? (annualRent / purchasePrice) * 100 : 0;
  const netYield = purchasePrice > 0 ? ((annualRent - annualCosts) / purchasePrice) * 100 : 0;

  return {
    purchasePrice, annualRent, annualCosts,
    grossYield, netYield, totalAcquisition,
    refurbCost: refurbItemsTotal, refurbWithContingency,
  };
}

export type YearProjection = {
  year: number;
  propertyValue: number;
  mortgageBalance: number;
  equity: number;
  annualRent: number;
  netCashflow: number;
  cumulativeCash: number;
  refinanceCashOut: number;
  refinanceEvent: boolean;
};

export type GrowthProjection = {
  years: YearProjection[];
  cashDeployed: number;
  exit5: { propertyValue: number; cashOut: number; netGain: number };
  exit10: { propertyValue: number; cashOut: number; netGain: number };
  refinanceTotal: number;
  payoffYear: number | null;
};

export function computeGrowthProjection(deal: Deal): GrowthProjection {
  const f = computeFinancials(deal);
  const cap = (parseFloat(deal.growth.capitalGrowthPct) || 0) / 100;
  const rentG = (parseFloat(deal.growth.rentalGrowthPct) || 0) / 100;
  const ltv = (parseFloat(deal.growth.ltvPct) || 0) / 100;
  const rate = (parseFloat(deal.growth.mortgageRatePct) || 0) / 100;
  const holdYears = Math.max(1, Math.min(15, parseInt(deal.growth.holdYears, 10) || 10));
  const refiYears = new Set(
    deal.growth.refinanceYears.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0)
  );

  const purchasePrice = f.purchasePrice;
  const startValue = purchasePrice + f.refurbWithContingency;

  let mortgageBalance = deal.growth.mortgageType === 'cash' ? 0 : purchasePrice * ltv;
  const cashDeployed = (purchasePrice + f.refurbWithContingency + 3000) - mortgageBalance;
  const monthlyRent0 = parseFloat(deal.financials.monthlyRent.replace(/[^0-9.]/g, '')) || 0;
  const annualCosts0 = parseFloat(deal.financials.annualCosts.replace(/[^0-9.]/g, '')) || 0;

  const years: YearProjection[] = [];
  let cumulativeCash = 0;
  let refinanceTotal = 0;
  let payoffYear: number | null = null;

  for (let y = 0; y <= holdYears; y++) {
    const propertyValue = startValue * Math.pow(1 + cap, y);
    const annualRent = monthlyRent0 * 12 * Math.pow(1 + rentG, y);
    const annualCosts = annualCosts0 * Math.pow(1 + rentG, y);
    const mortgageInterest = mortgageBalance * rate;
    const netCashflow = y === 0 ? 0 : annualRent - annualCosts - mortgageInterest;

    let refinanceCashOut = 0;
    let refinanceEvent = false;
    if (y > 0 && refiYears.has(y) && deal.growth.mortgageType !== 'cash') {
      const newMortgage = propertyValue * ltv;
      const redemption = 1500;
      refinanceCashOut = Math.max(0, newMortgage - mortgageBalance - redemption);
      mortgageBalance = newMortgage;
      refinanceEvent = true;
      refinanceTotal += refinanceCashOut;
    }

    cumulativeCash += netCashflow + refinanceCashOut;
    if (payoffYear === null && cumulativeCash >= cashDeployed) payoffYear = y;

    const equity = propertyValue - mortgageBalance;
    years.push({
      year: y, propertyValue, mortgageBalance, equity, annualRent, netCashflow, cumulativeCash, refinanceCashOut, refinanceEvent,
    });
  }

  function exitAt(y: number) {
    const yr = years[Math.min(y, years.length - 1)];
    const sellingCosts = yr.propertyValue * 0.02;
    const cashFromSale = yr.propertyValue - yr.mortgageBalance - sellingCosts;
    const cashOut = cashFromSale + yr.cumulativeCash;
    return { propertyValue: yr.propertyValue, cashOut, netGain: cashOut - cashDeployed };
  }

  return { years, cashDeployed, exit5: exitAt(5), exit10: exitAt(10), refinanceTotal, payoffYear };
}
