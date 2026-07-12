/**
 * Deal factory - directive-free so BOTH client and server can call it.
 *
 * `emptyDeal` used to live in `deal-store.ts`, but that module is `'use client'`
 * (it exposes the React `useDeal` hook and imports Server Actions). Importing a
 * runtime value from it into a server route (the lead ingress calls
 * `emptyDeal` via `fitForCandidate`) dragged the whole client/server-action
 * graph into the server bundle, which broke in the minified production build
 * with "d is not a function". Keeping the pure factory here, with no directive
 * and no client/server imports, severs that edge - the same reason the computed
 * helpers already live in the directive-free `deal-calcs.ts`.
 */

import type { Deal, GrowthDriver } from './deal-store';
import { defaultViewingChecklist } from './viewing';

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
    viewing: { roof: '', damp: '', windows: '', heating: '', electrics: '', structure: '', notes: '', photos: [], phase: 'pre', prep: '', summary: '', outcome: '', checklist: defaultViewingChecklist(), assessment: '', signedOffBy: '', signedOffAt: '' },
    viewings: [],
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
