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
import { emptyDeal } from './deal-factory';
import type { InspectionState } from './inspection';
import type { LegalPackAnalysis } from './legal-pack';

export type StageRating = 'Good' | 'OK' | 'Issue' | '';

// M5 viewing: a photo-checklist point captured at a viewing.
export type ViewingChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  rating?: StageRating;
  photo?: string;   // base64 data URI
  note?: string;
};

// A dated viewing record kept in history (1st viewing, 2nd, client viewing...).
export type ViewingRecord = {
  id: string;
  date: string;            // ISO timestamp of the viewing
  attendee?: string;       // who attended (partner / client / agent)
  checklist: ViewingChecklistItem[];
  notes: string;
  assessment?: string;     // post-viewing top-level assessment
  comments?: string;       // post-viewing further comments
  outcome?: 'proceed' | 'pass' | 'undecided' | '';
  signedOffBy?: string;
  signedOffAt?: string;
};
export type MortgageType = 'cash' | 'interest-only' | 'repayment';

/** M5 pipeline board stages (lead -> sourcing -> ... -> offer outcome -> follow-up). */
export type PipelineStage =
  | 'leads' | 'sourcing' | 'viewing' | 'analysis' | 'report' | 'offer' | 'won' | 'lost' | 'followup';

/**
 * M5 lead-intake: where a scraped lead came from and the radar signals that
 * flagged it. Nested jsonb on the Deal (no migration). Populated by
 * candidateToDealInput in lead-intake.ts.
 */
export type LeadSourceMeta = {
  channel: 'portal' | 'auction' | 'open-data' | 'direct';
  market?: 'on-market' | 'off-market';
  sourceName?: string;
  listingUrl?: string;
  sourceRef?: string;
  capturedAt?: string;
  discountConfidence?: number;
  discountReasons?: string[];
  estMarketValue?: number;
  estAchievable?: number;
};

export type Comp = {
  id: string;
  address: string;
  detail: string;
  value: string;
  floorArea?: string; // sqft - sales comps only; drives the price-per-sqft GDV
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

// HMLR INSPIRE: freehold plot boundary polygon (WGS84 GeoJSON geometry).
export type BoundaryInfo = {
  inspireId?: string;
  geojson: { type: string; coordinates: unknown };
};

// Ofcom Connected Nations: fixed-broadband coverage at the postcode.
export type BroadbandInfo = {
  maxDownloadMbps?: number;
  superfastPct?: number;    // % premises >= 30 Mbit/s
  ultrafastPct?: number;    // % premises >= 300 Mbit/s
  fullFibrePct?: number;    // % premises with FTTP
  premises?: number;
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
  | 'riverLevels' | 'landOwnership' | 'broadband' | 'boundary';

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
  broadband?: BroadbandInfo;
  boundary?: BoundaryInfo;
  rentTrend?: RentTrendInfo;
};

/**
 * Local rent-trend (annual % change), county/regional. Reserved seam for a
 * future ONS Price Index of Private Rents (PIPR) feed; when present it drives
 * the rent-comp uplift instead of the 4% default.
 */
export type RentTrendInfo = {
  annualGrowthPct: number;
  area: string;       // region / county the rate is for
  asOfMonth: string;  // YYYY-MM
  source: string;     // e.g. "ONS PIPR"
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

  // M5 lead-intake: provenance + radar signals for a scraped lead (nested jsonb).
  leadSource?: LeadSourceMeta;

  // BSE-OPP-P01 M1: the network investor this lead was matched to at ingest,
  // attached to the deal on approve. Nested jsonb (no migration). `client` above
  // mirrors `name` for display; this block keeps the id, fit and reasons.
  matchedInvestor?: {
    id: string;
    name: string;
    pct: number;
    reasons: string[];
  };

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
    // M11: server-side Legal Pack Analyser result (four sections + derived
    // buyer-fees total). Stored in the inputs jsonb, no migration.
    legalPack?: LegalPackAnalysis;
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
    // M5 viewing sub-states: before (prep), on (photo checklist), after
    // (assessment + comments + sign-off). `phase` is the partner's current tab.
    phase?: 'pre' | 'on' | 'inspect' | 'post';
    prep?: string;
    summary?: string;            // post-viewing "further comments"
    outcome?: 'proceed' | 'pass' | 'undecided' | '';
    checklist?: ViewingChecklistItem[];   // the 12 photo points
    assessment?: string;         // post-viewing top-level assessment
    signedOffBy?: string;        // human-in-the-loop sign-off (gates client send)
    signedOffAt?: string;        // ISO timestamp of sign-off
    // M6 guided inspection: rated walkthrough + measured rooms + refurb costs.
    inspection?: InspectionState;
  };

  // Past viewings, newest last. The live `viewing` above is the working one;
  // "Log viewing" snapshots it here so history is never overwritten.
  viewings?: ViewingRecord[];

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

// emptyDeal moved to the directive-free `deal-factory` so server code (the lead
// ingress) can build a draft Deal without importing this `'use client'` module.
// Imported for internal use (rowToDeal) and re-exported so existing client
// imports from `@/lib/deal-store` keep working.
export { emptyDeal };

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
