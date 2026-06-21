'use server';

/**
 * Public-data orchestrator (M2).
 *
 * One action drives the whole "portal pull": geocode the postcode, fan out to
 * every source in parallel (each independently fail-soft), assemble a single
 * PublicData object with per-source status, and persist it onto the deal. Crime
 * and amenities land under `location` (where the existing components read them);
 * everything else under `publicData`. Local HPI seeds the default capital-growth
 * assumption.
 *
 * Adding a source = write a fetcher under server/public-data and add one line to
 * the Promise.all below. Tenant ownership is enforced by reusing loadDeal /
 * updateDealById from the deals action.
 */

import type {
  Deal, PublicData, PublicDataStatus, PublicDataSourceKey, Demographics,
} from '@/lib/deal-store';
import { loadDeal, updateDealById } from './deals';
import { geocodePostcode, extractPostcode } from '@/server/public-data/geocode';
import { fetchHpi } from '@/server/public-data/hpi';
import { fetchCrime } from '@/server/public-data/crime';
import { fetchFlood } from '@/server/public-data/flood';
import { fetchAmenities } from '@/server/public-data/amenities';
import { fetchPricePaid } from '@/server/public-data/price-paid';
import { fetchPlanning } from '@/server/public-data/planning';
import { fetchCouncilTax } from '@/server/public-data/council-tax';
import { fetchEpc } from '@/server/public-data/epc';
import { lookupCompany } from '@/server/public-data/companies';
import { buildMapLayers } from '@/server/maps/static-maps';
import type { VendorCompany } from '@/lib/deal-store';

function status(v: unknown): PublicDataStatus {
  return v == null ? 'unavailable' : 'ok';
}

/** IMD rank (1..32844) -> decile (1 = most deprived 10%). */
function imdDecile(rank?: number): number | undefined {
  if (!rank) return undefined;
  return Math.min(10, Math.max(1, Math.ceil(rank / 3284.4)));
}

/**
 * Default capital-growth from local HPI plus the BUILD §M2-T1 weighting:
 * base = 10yr HPI CAGR; flood band 3 -0.3%; most-deprived-3-deciles -0.5%
 * (deprivation proxy for the crime-decile rule, since the police API gives no
 * decile); employment +0.2% omitted (no clean per-area source yet). Clamped to
 * a sane 0-8% band.
 */
function weightedGrowth(cagr: number, floodBand: 1 | 2 | 3 | null, decile?: number): number {
  let g = cagr;
  if (floodBand === 3) g -= 0.3;
  if (decile != null && decile <= 3) g -= 0.5;
  return Math.round(Math.max(0, Math.min(8, g)) * 10) / 10;
}

export type PullResult = {
  ok: boolean;
  message: string;
  publicData?: PublicData;
  /** Full field patch the server persisted, for the client to merge into local state. */
  applied?: Partial<Deal>;
};

export async function pullPublicData(dealId: string): Promise<PullResult> {
  const row = await loadDeal(dealId);
  if (!row) return { ok: false, message: 'Deal not found.' };

  const inputs = (row.inputs as Partial<Deal>) ?? {};
  const address = row.address ?? '';
  const rawPostcode = row.postcode ?? extractPostcode(address);
  if (!rawPostcode) {
    return { ok: false, message: 'No postcode found on this deal. Add one to the address first.' };
  }

  const geo = await geocodePostcode(rawPostcode);
  if (!geo) {
    const publicData: PublicData = {
      postcode: rawPostcode,
      fetchedAt: new Date().toISOString(),
      status: { geocode: 'unavailable' },
    };
    await updateDealById(dealId, { postcode: rawPostcode, publicData });
    return { ok: false, message: `Could not geocode ${rawPostcode}. Other sources skipped.`, publicData };
  }

  // Fan out. Each fetcher is already fail-soft (returns null on failure).
  const [hpi, crime, flood, amenities, pricePaid, planning, councilTax, epc] = await Promise.all([
    fetchHpi(geo.district, geo.districtCode),
    fetchCrime(geo.lat, geo.lng),
    fetchFlood(geo.postcode, geo.lat, geo.lng),
    fetchAmenities(geo.postcode, geo.lat, geo.lng),
    fetchPricePaid(geo.postcode),
    fetchPlanning(geo.postcode, geo.lat, geo.lng),
    fetchCouncilTax(geo.postcode, address),
    fetchEpc(geo.postcode, address),
  ]);

  const demographics: Demographics = {
    imdRank: geo.imdRank,
    imdDecile: imdDecile(geo.imdRank),
    lsoa: geo.lsoa,
    ward: geo.ward,
    constituency: geo.constituency,
    adminCounty: geo.adminCounty,
    parish: geo.parish,
    region: geo.region,
  };

  // Static maps depend on the coordinates + flood/crime/amenities outputs.
  const maps = buildMapLayers({
    lat: geo.lat,
    lng: geo.lng,
    floodBand: flood?.band ?? null,
    amenities: amenities ?? [],
    crimeTotal: crime?.total12mo ?? 0,
  });

  const statusMap: Partial<Record<PublicDataSourceKey, PublicDataStatus>> = {
    geocode: 'ok',
    demographics: 'ok',
    hpi: status(hpi),
    crime: status(crime),
    flood: status(flood),
    amenities: status(amenities),
    pricePaid: status(pricePaid),
    planning: status(planning),
    councilTax: status(councilTax),
    epc: status(epc),
    maps: maps ? 'ok' : 'unavailable',
  };

  const publicData: PublicData = {
    postcode: geo.postcode,
    lat: geo.lat,
    lng: geo.lng,
    district: geo.district,
    districtCode: geo.districtCode,
    fetchedAt: new Date().toISOString(),
    status: statusMap,
    ...(hpi ? { hpi } : {}),
    ...(flood ? { flood } : {}),
    ...(pricePaid ? { pricePaid } : {}),
    ...(planning ? { planning } : {}),
    ...(councilTax ? { councilTax } : {}),
    ...(epc ? { epc } : {}),
    ...(maps ? { maps } : {}),
    demographics,
  };

  // Merge into the deal. Crime/amenities go to `location`; never clobber
  // existing manual data with a null pull.
  const existingLocation = inputs.location ?? { contextImages: [], amenities: [] };
  const patch: Partial<Deal> = {
    postcode: geo.postcode,
    publicData,
    location: {
      ...existingLocation,
      ...(crime ? { crime } : {}),
      ...(amenities ? { amenities } : {}),
    },
  };

  // Seed the default growth from local HPI, but only if the partner hasn't
  // already moved it off the system default.
  if (hpi) {
    const existingGrowth = inputs.growth;
    const current = existingGrowth?.capitalGrowthPct;
    if (!current || current === '3.0') {
      const g = weightedGrowth(hpi.cagr10yrPct, flood?.band ?? null, imdDecile(geo.imdRank));
      patch.growth = { ...(existingGrowth as Deal['growth']), capitalGrowthPct: g.toFixed(1) };
    }
  }

  await updateDealById(dealId, patch);

  const okCount = Object.values(statusMap).filter((s) => s === 'ok').length;
  const total = Object.keys(statusMap).length;
  return {
    ok: true,
    message: `Pulled ${okCount}/${total} sources for ${geo.postcode}.`,
    publicData,
    applied: patch,
  };
}

export type CompanyLookupResult = {
  ok: boolean;
  message: string;
  company?: VendorCompany;
};

/**
 * On-demand vendor company lookup (Companies House). Not part of the postcode
 * pull - the sourcer supplies a company name or number. Persists onto the deal.
 */
export async function lookupVendorCompany(dealId: string, query: string): Promise<CompanyLookupResult> {
  const row = await loadDeal(dealId);
  if (!row) return { ok: false, message: 'Deal not found.' };
  if (!query.trim()) return { ok: false, message: 'Enter a company name or number.' };

  const company = await lookupCompany(query);
  if (!company) {
    return {
      ok: false,
      message: 'No company found (or the Companies House key is not configured).',
    };
  }
  const withTime: VendorCompany = { ...company, fetchedAt: new Date().toISOString() };
  await updateDealById(dealId, { vendorCompany: withTime });
  return { ok: true, message: `Found ${company.companyName} (${company.companyNumber}).`, company: withTime };
}
