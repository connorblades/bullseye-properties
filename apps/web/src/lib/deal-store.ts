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

/** M5 pipeline board stages (lead -> sourcing -> ... -> offer outcome -> follow-up). */
export type PipelineStage =
  | 'leads' | 'sourcing' | 'viewing' | 'analysis' | 'report' | 'offer' | 'won' | 'lost' | 'followup';

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

// HMLR CCOD/OCOD: company owners of property at the postcode (free; corporate
// owners only - individuals are not in the free datasets).
export type CorporateOwner = {
  name: string;
  companyRegNo?: string;
  category?: string;     // e.g. "Limited Company or PLC"
  country?: string;      // for overseas (OCOD)
};
export type LandOwnershipTitle = {
  titleNumber: string;
  tenure?: string;
  address?: string;
  pricePaid?: number;
  dataset: 'ccod' | 'ocod';
  proprietors: CorporateOwner[];
};
export type LandOwnershipInfo = {
  titles: LandOwnershipTitle[];   // corporate-owned titles at this postcode
};

// EA real-time flood-monitoring: nearest river-level monitoring stations.
export type RiverStation = {
  label: string;
  riverName?: string;
  town?: string;
  distanceKm: number;
};
export type RiverLevelInfo = {
  stations: RiverStation[];   // nearest first
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
  crime?: string;
  // Flood is a composite: a Mapbox aerial base + the EA flood-zone WMS overlay
  // (transparent PNG) for the same bbox, stacked in the UI.
  floodBase?: string;
  floodOverlay?: string;      // EA flood-zone polygons (shaded risk area)
};

// planning.data.gov.uk gives designations; PlanIt gives actual applications.
export type PlanningApplication = {
  reference: string;
  description: string;
  appType?: string;           // e.g. "Full", "Listed Building Consent"
  status?: string;            // e.g. "Undecided", "Permitted", "Refused"
  startDate?: string;
  decidedDate?: string;
  distanceKm?: number;
  address?: string;
  url?: string;
  residential?: boolean;      // mentions dwellings/homes/housing
  units?: number;             // parsed dwelling count where stated
};

// Census 2021 area profile (MSOA): population + labour market.
export type AreaStats = {
  areaName: string;
  population: number;
  densityPerKm2: number;
  employmentRate?: number;        // % in employment
  economicActivityRate?: number;
  inactiveRate?: number;
  unemployedRate?: number;
};

// Open-Meteo air quality (European AQI).
export type AirQualityInfo = {
  aqi: number;
  band: string;                   // Good | Fair | Moderate | Poor | Very poor | Extremely poor
  pm25?: number;
  pm10?: number;
  no2?: number;
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

// Nearest schools with Ofsted ratings (DfE/Ofsted data).
export type SchoolInfo = {
  name: string;
  type: string;              // Primary | Secondary | ...
  ofstedRating?: string;     // Outstanding | Good | Requires improvement | Inadequate
  ofstedDate?: string;
  distanceMi: number;
};

export type PublicDataSourceKey =
  | 'geocode' | 'demographics' | 'hpi' | 'crime' | 'flood'
  | 'amenities' | 'pricePaid' | 'planning' | 'planningApplications'
  | 'schools' | 'areaStats' | 'airQuality' | 'councilTax' | 'epc' | 'maps'
  | 'riverLevels' | 'landOwnership';

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
  planningApplications?: PlanningApplication[];
  schools?: SchoolInfo[];
  areaStats?: AreaStats;
  airQuality?: AirQualityInfo;
  councilTax?: CouncilTaxInfo;
  epc?: EpcInfo;
  maps?: MapLayers;
  riverLevels?: RiverLevelInfo;
  landOwnership?: LandOwnershipInfo;
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
  councilTaxBand?: string;   // manual - VOA has no API (see council-tax UI + link)

  // M3: partner-published Claude narratives, keyed by section. Written at
  // publish (Stage 14) after edit-in-place; read by the PDF render (M3-T10).
  narratives?: Partial<Record<
    'why-this-fits' | 'location' | 'condition' | 'offer-rationale' | 'next-steps',
    string
  >>;

  // M5 pipeline: partner-controlled board stage (stored in inputs jsonb, no
  // migration). When unset, the board derives a stage from wizard progress.
  pipelineStage?: PipelineStage;
  followUpAt?: string;   // ISO date for the next follow-up, if scheduled

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
    // M5 viewing sub-states: before (prep), on (condition assessment), after
    // (summary + outcome). `phase` is the partner's current sub-state.
    phase?: 'pre' | 'on' | 'post';
    prep?: string;
    summary?: string;
    outcome?: 'proceed' | 'pass' | 'undecided' | '';
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
  const base: Deal = {
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
    viewing: { roof: '', damp: '', windows: '', heating: '', electrics: '', structure: '', notes: '', photos: [], phase: 'pre', prep: '', summary: '', outcome: '' },
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
  };

  // Deep-merge each nested group so a deal reconstructed from partial stored
  // data always has a complete shape. A shallow `...initial` would replace a
  // whole group (e.g. `growth`) with a partial one, dropping keys like
  // `growth.drivers` and crashing the stage that maps over them.
  return {
    ...base,
    ...initial,
    criteria: { ...base.criteria, ...(initial.criteria ?? {}) },
    location: { ...base.location, ...(initial.location ?? {}) },
    property: { ...base.property, ...(initial.property ?? {}) },
    auction: { ...base.auction, ...(initial.auction ?? {}) },
    viewing: { ...base.viewing, ...(initial.viewing ?? {}) },
    growth: { ...base.growth, ...(initial.growth ?? {}) },
    refurb: { ...base.refurb, ...(initial.refurb ?? {}) },
    financials: { ...base.financials, ...(initial.financials ?? {}) },
    offer: { ...base.offer, ...(initial.offer ?? {}) },
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
// Computed values - moved to the directive-free `deal-calcs` module so server
// code (PDF render, Claude context) can call them too. Re-exported here so
// existing client imports from `@/lib/deal-store` keep working.
// ────────────────────────────────────────────────────────────────────────────
export {
  parseSoldMonth,
  parseMoney,
  hpiAdjustValue,
  computeFinancials,
  computeGrowthProjection,
} from './deal-calcs';
export type { ComputedFinancials, YearProjection, GrowthProjection } from './deal-calcs';
