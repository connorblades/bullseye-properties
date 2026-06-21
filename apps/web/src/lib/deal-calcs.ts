/**
 * Pure deal calculations - NO 'use client' directive, so these are safe to call
 * from both client components and server code (PDF render, Claude context). The
 * client-facing deal-store re-exports them for backwards compatibility.
 */

import type { Deal, HpiInfo } from './deal-store';

// ── HPI comp adjustment ──────────────────────────────────────────────────────

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
