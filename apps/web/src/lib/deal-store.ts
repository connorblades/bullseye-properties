'use client';

/**
 * Deal store — server-backed via Server Actions.
 *
 * M1 close: persistence lives in Postgres (`deals` table). Top-level metadata
 * goes into columns, the wizard inputs nest into the `inputs` jsonb. The
 * client never knows or cares about that split — it sees and edits one
 * unified `Deal` object.
 *
 * The component-facing API mirrors what the original localStorage version
 * exposed so the wizard pages didn't need to be rewritten: `useDeal(id)`
 * returns `[deal, update]`; `update(patch)` is fire-and-forget with a
 * built-in 800ms debounce that coalesces rapid keystrokes into one save.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listDealsForTenant,
  loadDeal,
  updateDealById,
} from '@/server/actions/deals';

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
  lat?: number;   // populated by the live Overpass pull; used for map pins
  lng?: number;
};

export type CrimeStats = {
  total12mo: number;
  per1000: string;
  districtAvg: string;
  comparison: 'lower' | 'similar' | 'higher';
  comparisonPct: string;
  breakdown: { category: string; count: number }[];
};

// ─── M2 public-data shapes ──────────────────────────────────────────────────
// Populated by the pullPublicData server action. Crime and amenities continue
// to live under `location` (the existing components read them there); the rest
// nests under `publicData` alongside per-source fetch status for fail-soft UI.

export type PublicDataStatus = 'ok' | 'fallback' | 'unavailable' | 'pending';

export type FloodInfo = {
  band: 1 | 2 | 3 | null;     // EA Flood Map for Planning zone (1 low … 3 high)
  riskLabel: string;          // e.g. "Flood Zone 3 - High risk"
  riversAndSea: string;       // descriptive risk-from-rivers-and-sea
  surfaceWater: string;       // descriptive surface-water risk
  hasActiveWarning: boolean;  // any live EA flood warning/alert covering the point
  source: string;
};

export type HpiPoint = { month: string; index: number }; // month = YYYY-MM
export type HpiInfo = {
  district: string;
  districtCode: string;
  latestMonth: string;        // YYYY-MM
  latestIndex: number;
  latestAvgPrice: number;
  cagr10yrPct: number;        // 10-year compound annual growth, %
  series: HpiPoint[];         // monthly index, ascending by month
};

export type MapLayers = {
  amenities?: string;         // Mapbox static image URL
  flood?: string;
  crime?: string;
};

// Census/deprivation context, lifted from postcodes.io (free, no extra call).
export type Demographics = {
  imdRank?: number;           // 1 = most deprived of 32,844 LSOAs
  imdDecile?: number;         // 1 (most deprived) .. 10 (least)
  lsoa?: string;
  ward?: string;
  constituency?: string;
  adminCounty?: string;
  parish?: string;
  region?: string;
};

// Land Registry Price Paid - actual recorded sales for the postcode.
export type PricePaidTxn = {
  date: string;               // YYYY-MM-DD
  price: number;
  paon: string;               // primary addressable object (house no./name)
  street: string;
  postcode: string;
  propertyType: string;       // Detached | Semi | Terraced | Flat | Other
  newBuild: boolean;
  tenure: string;             // Freehold | Leasehold
};
export type PricePaidInfo = {
  postcode: string;
  transactions: PricePaidTxn[];   // newest first
};

// planning.data.gov.uk point designations.
export type PlanningDesignation = {
  dataset: string;            // 'conservation-area' | 'listed-building' | ...
  name: string;
  reference?: string;
};
export type PlanningInfo = {
  designations: PlanningDesignation[];
  conservationArea: boolean;
  listed: boolean;
};

// VOA council tax band (scraped, fail-soft).
export type CouncilTaxInfo = {
  band: string | null;        // A..H
  source: string;
};

// EPC register (keyed).
export type EpcInfo = {
  currentRating: string;      // A..G
  currentScore: number;
  potentialRating: string;
  potentialScore: number;
  floorAreaM2?: number;
  propertyType?: string;
  builtForm?: string;
  ageBand?: string;
  mainHeating?: string;
  lodgementDate?: string;
  address?: string;
};

// Companies House - on-demand vendor lookup (not postcode-keyed), stored on the
// deal separately from the postcode auto-pull. See `Deal.vendorCompany`.
export type CompanyOfficer = {
  name: string;
  role: string;
  appointedOn?: string;
  resignedOn?: string;
};
export type VendorCompany = {
  companyNumber: string;
  companyName: string;
  status: string;             // active | dissolved | liquidation | ...
  type?: string;
  incorporatedOn?: string;
  registeredOffice?: string;
  sicCodes?: string[];
  officers: CompanyOfficer[];
  chargesCount?: number;
  hasInsolvency?: boolean;
  fetchedAt?: string;
};

export type PublicDataSourceKey =
  | 'geocode' | 'demographics' | 'hpi' | 'crime' | 'flood'
  | 'amenities' | 'pricePaid' | 'planning' | 'councilTax' | 'epc' | 'maps';

export type PublicData = {
  postcode: string;
  lat?: number;
  lng?: number;
  district?: string;
  districtCode?: string;
  fetchedAt?: string;         // ISO timestamp of the last pull
  status: Partial<Record<PublicDataSourceKey, PublicDataStatus>>;
  flood?: FloodInfo;
  hpi?: HpiInfo;
  demographics?: Demographics;
  pricePaid?: PricePaidInfo;
  planning?: PlanningInfo;
  councilTax?: CouncilTaxInfo;
  epc?: EpcInfo;
  maps?: MapLayers;
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
  postcode?: string;
  client: string;
  source: 'estate-agent' | 'auction' | 'direct-to-vendor';
  progress: number;
  delivered: boolean;

  publicData?: PublicData;
  vendorCompany?: VendorCompany;

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

const SAVE_DEBOUNCE_MS = 800;

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

/**
 * Build an in-memory Deal with sensible defaults. Used by /deal/new before
 * the row exists in Postgres, and to fill in missing nested fields when a
 * row loaded from the database doesn't have every key populated yet.
 */
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

/**
 * Reconstruct a Deal from a server row.
 * Server columns are merged with the inputs jsonb, then defaults from
 * emptyDeal() backfill anything still missing (early-stage deals where
 * the wizard hasn't populated every section yet).
 */
type ServerDealRow = {
  id: string;
  address: string;
  postcode: string | null;
  source: string;
  currentStage: number;
  delivered: boolean;
  createdAt: Date;
  inputs: unknown;
};

function rowToDeal(row: ServerDealRow): Deal {
  const inputs = (row.inputs as Partial<Deal>) ?? {};
  return emptyDeal(row.id, {
    ...inputs,
    id: row.id,
    address: row.address,
    postcode: row.postcode ?? inputs.postcode,
    source: row.source as Deal['source'],
    progress: row.currentStage,
    delivered: row.delivered,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * List all deals visible to the current user's tenant.
 * Called by the dashboard on mount.
 */
export async function listDeals(): Promise<Deal[]> {
  const rows = await listDealsForTenant();
  return rows.map(rowToDeal);
}

/**
 * useDeal — async load + debounced save.
 *
 * On mount: fetches the deal via server action.
 * On update(patch): merges patch into local state immediately (optimistic),
 * then schedules a debounced server-action write 800ms later. Coalesces
 * rapid keystrokes into one save.
 */
export function useDeal(dealId: string): readonly [Deal | null, (patch: Partial<Deal>) => void, { loading: boolean; error: string | null }] {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Partial<Deal>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadDeal(dealId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setDeal(null);
        } else {
          setDeal(rowToDeal(row as ServerDealRow));
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load deal.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dealId]);

  const flush = useCallback(async () => {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await updateDealById(dealId, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }, [dealId]);

  const update = useCallback(
    (patch: Partial<Deal>) => {
      setDeal((prev) => (prev ? { ...prev, ...patch } : prev));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Flush any pending save when the component unmounts (route change).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flush();
      }
    };
  }, [flush]);

  return [deal, update, { loading, error }] as const;
}

/**
 * Set or advance a deal's stage. Wraps updateDealById so callers don't need
 * to know the patch shape.
 */
export async function setStageProgress(dealId: string, stage: number): Promise<void> {
  await updateDealById(dealId, { progress: stage });
}

// ────────────────────────────────────────────────────────────────────────────
// Computed values (pure functions on the in-memory Deal object).
// ────────────────────────────────────────────────────────────────────────────

// ── HPI comp adjustment (pure, client-safe) ──────────────────────────────────

/** Pull a YYYY-MM out of a comp's free-text detail (e.g. "Sold 2025-08 ..."). */
export function parseSoldMonth(detail: string): string | null {
  const m = detail.match(/(\d{4})[-/](\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Parse a £ value string ("£128,000") to a number, or null. */
export function parseMoney(value: string): number | null {
  const n = parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Adjust a sold price from its sold-month index to the latest-month index.
 * Returns null if the sold month can't be mapped to the HPI series.
 */
export function hpiAdjustValue(
  soldPrice: number,
  soldMonth: string,
  hpi: HpiInfo,
): { adjusted: number; ratio: number } | null {
  const exact = hpi.series.find((p) => p.month === soldMonth);
  const earlier = exact ?? [...hpi.series].reverse().find((p) => p.month <= soldMonth);
  if (!earlier || earlier.index <= 0) return null;
  const ratio = hpi.latestIndex / earlier.index;
  return { adjusted: Math.round(soldPrice * ratio), ratio };
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
