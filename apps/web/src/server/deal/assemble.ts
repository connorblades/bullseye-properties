import 'server-only';
import type { Deal } from '@/lib/deal-store';

/**
 * Reconstruct a full Deal object from a database row, server-side.
 *
 * Mirrors rowToDeal in deal-store.ts (a `'use client'` module we must not pull
 * into server code). The `inputs` jsonb holds the nested wizard data; columns
 * carry the top-level metadata. Nested groups are defaulted so prompt building
 * never trips over a deal that hasn't reached every stage yet.
 */

type DealRow = {
  id: string;
  address: string;
  postcode: string | null;
  source: string;
  currentStage: number;
  delivered: boolean;
  createdAt: Date | string;
  inputs: unknown;
};

export function assembleDeal(row: DealRow): Deal {
  const inputs = (row.inputs as Partial<Deal>) ?? {};
  return {
    id: row.id,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    address: row.address,
    postcode: row.postcode ?? inputs.postcode ?? undefined,
    client: inputs.client ?? '',
    source: (row.source as Deal['source']) ?? 'estate-agent',
    progress: row.currentStage,
    delivered: row.delivered,
    publicData: inputs.publicData,
    vendorCompany: inputs.vendorCompany,
    councilTaxBand: inputs.councilTaxBand,
    narratives: inputs.narratives,
    criteria: { budget: '', areas: '', propertyType: '', targetYield: '', refurbTolerance: '', epcRequirement: '', timeline: '', ...(inputs.criteria ?? {}) },
    location: { contextImages: [], amenities: [], ...(inputs.location ?? {}) },
    property: { type: '', bedrooms: '', bathrooms: '', floorArea: '', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '', documents: [], ...(inputs.property ?? {}) },
    salesComps: inputs.salesComps ?? [],
    rentalComps: inputs.rentalComps ?? [],
    auction: { isAuction: false, buyerFees: '', specialConditions: '', restrictiveCovenants: '', ...(inputs.auction ?? {}) },
    viewing: { roof: '', damp: '', windows: '', heating: '', electrics: '', structure: '', notes: '', photos: [], ...(inputs.viewing ?? {}) },
    growth: { capitalGrowthPct: '3.0', rentalGrowthPct: '2.0', mortgageType: 'interest-only', ltvPct: '75', mortgageRatePct: '5.8', holdYears: '10', refinanceYears: '2,5', drivers: [], ...(inputs.growth ?? {}) },
    refurb: { needed: false, items: [], contingencyPct: '10', weeks: '', ...(inputs.refurb ?? {}) },
    financials: { purchasePrice: '', monthlyRent: '', annualCosts: '', ...(inputs.financials ?? {}) },
    offer: { recommended: '', strategy: '', ...(inputs.offer ?? {}) },
  };
}
