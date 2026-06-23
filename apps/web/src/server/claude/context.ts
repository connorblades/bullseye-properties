import 'server-only';
import type { Deal } from '@/lib/deal-store';
import { computeFinancials, computeGrowthProjection } from '@/lib/deal-calcs';

/**
 * Build the plain-text fact digest fed to every section prompt (M3-T2).
 *
 * Pulls from the partner's own inputs (deal.*) and the M2 public-data pull
 * (deal.publicData). Only facts that exist are included - empty fields are
 * dropped so Claude is never tempted to fill a labelled blank. Computed
 * financials are derived from the same inputs, never invented.
 *
 * Keep this exhaustive: the grounding guarantee is only as good as the facts
 * we give Claude. Anything omitted here, Claude must tag [VERIFY: ...].
 */
export function buildDealContext(deal: Deal): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const s = String(value).trim();
    if (s) lines.push(`${label}: ${s}`);
  };
  const heading = (h: string) => lines.push('', `## ${h}`);

  const fin = computeFinancials(deal);
  const pd = deal.publicData;

  heading('Property');
  push('Address', deal.address);
  push('Postcode', deal.postcode ?? pd?.postcode);
  push('Source', deal.source);
  push('Type', deal.property.type);
  push('Bedrooms', deal.property.bedrooms);
  push('Bathrooms', deal.property.bathrooms);
  push('Floor area (sqft)', deal.property.floorArea);
  push('Plot size (sqft)', deal.property.plotSize);
  push('Parking', deal.property.parking);
  push('Year built', deal.property.yearBuilt);
  push('Heating', deal.property.heating);
  push('Asking price (£)', deal.property.askingPrice);

  heading('Investor criteria');
  push('Budget', deal.criteria.budget);
  push('Preferred areas', deal.criteria.areas);
  push('Wanted property type', deal.criteria.propertyType);
  push('Target gross yield', deal.criteria.targetYield);
  push('Refurb tolerance', deal.criteria.refurbTolerance);
  push('EPC requirement', deal.criteria.epcRequirement);
  push('Timeline', deal.criteria.timeline);

  heading('Financials (from partner inputs)');
  push('Intended purchase price (£)', deal.financials.purchasePrice);
  push('Expected monthly rent (£)', deal.financials.monthlyRent);
  push('Annual costs (£)', deal.financials.annualCosts);
  if (fin.grossYield > 0) push('Gross yield (%)', fin.grossYield.toFixed(1));
  if (fin.netYield > 0) push('Net yield (%)', fin.netYield.toFixed(1));
  if (fin.refurbWithContingency > 0) push('Refurb incl. contingency (£)', Math.round(fin.refurbWithContingency));
  if (fin.totalAcquisition > 0) push('Total acquisition (£)', Math.round(fin.totalAcquisition));

  heading('Growth assumptions + projection');
  push('Capital growth pa (%)', deal.growth.capitalGrowthPct);
  push('Rental growth pa (%)', deal.growth.rentalGrowthPct);
  push('Mortgage type', deal.growth.mortgageType);
  push('LTV (%)', deal.growth.ltvPct);
  push('Mortgage rate (%)', deal.growth.mortgageRatePct);
  push('Hold period (years)', deal.growth.holdYears);
  push('Refinance years', deal.growth.refinanceYears);
  try {
    const proj = computeGrowthProjection(deal);
    push('Cash deployed (£)', Math.round(proj.cashDeployed));
    push('Projected value at year 5 (£)', Math.round(proj.exit5.propertyValue));
    push('Projected value at year 10 (£)', Math.round(proj.exit10.propertyValue));
  } catch {
    // projection needs numeric inputs; skip silently if absent
  }
  if (deal.growth.drivers?.some((d) => d.title || d.justification)) {
    lines.push('Local growth drivers stated by partner:');
    deal.growth.drivers
      .filter((d) => d.title || d.justification)
      .forEach((d) => lines.push(`  - ${d.title || 'Driver'}: ${d.justification || '(no detail)'}`));
  }

  heading('Condition (viewing report)');
  push('Roof', deal.viewing.roof);
  push('Damp', deal.viewing.damp);
  push('Windows', deal.viewing.windows);
  push('Heating', deal.viewing.heating);
  push('Electrics', deal.viewing.electrics);
  push('Structure', deal.viewing.structure);
  push('Viewing notes', deal.viewing.notes);

  if (deal.refurb.needed && deal.refurb.items.length) {
    heading('Refurbishment plan');
    push('Contingency (%)', deal.refurb.contingencyPct);
    push('Estimated weeks', deal.refurb.weeks);
    deal.refurb.items
      .filter((i) => i.name || i.cost)
      .forEach((i) => lines.push(`  - ${i.name || 'Item'}: £${i.cost || '?'}`));
  }

  if (deal.salesComps.length) {
    heading('Sales comparables (partner evidence)');
    deal.salesComps.forEach((c) => lines.push(`  - ${c.address || 'Comp'}: ${c.value || '?'} (${c.detail || 'no detail'})`));
  }
  if (deal.rentalComps.length) {
    heading('Rental comparables (partner evidence)');
    deal.rentalComps.forEach((c) => lines.push(`  - ${c.address || 'Comp'}: ${c.value || '?'} (${c.detail || 'no detail'})`));
  }

  if (deal.auction.isAuction) {
    heading('Auction');
    push('Buyer-side fees (£)', deal.auction.buyerFees);
    push('Special conditions', deal.auction.specialConditions);
    push('Restrictive covenants', deal.auction.restrictiveCovenants);
  }

  // ── M2 public data ────────────────────────────────────────────────────────
  if (pd) {
    heading('Public data (auto-pulled)');
    push('District', pd.district);
    if (pd.flood) push('Flood', `${pd.flood.riskLabel} (${pd.flood.riversAndSea})`);
    if (pd.epc) push('EPC', `current ${pd.epc.currentRating} (${pd.epc.currentScore}), potential ${pd.epc.potentialRating} (${pd.epc.potentialScore})`);
    if (pd.hpi) push('HPI', `${pd.hpi.district} latest avg £${Math.round(pd.hpi.latestAvgPrice).toLocaleString()}, 10yr CAGR ${pd.hpi.cagr10yrPct}%`);
    if (pd.councilTax?.band) push('Council tax band', pd.councilTax.band);
    if (pd.demographics) {
      push('IMD decile', pd.demographics.imdDecile ? `${pd.demographics.imdDecile}/10 (1=most deprived)` : undefined);
      push('Ward', pd.demographics.ward);
      push('Constituency', pd.demographics.constituency);
    }
    if (pd.areaStats) {
      push('Area population', pd.areaStats.population?.toLocaleString());
      push('Employment rate (%)', pd.areaStats.employmentRate);
    }
    if (pd.airQuality) push('Air quality', `${pd.airQuality.band} (AQI ${pd.airQuality.aqi})`);
    if (pd.riverLevels?.stations?.length) {
      const s = pd.riverLevels.stations[0];
      push('Nearest river-level station', `${s.riverName ? `${s.riverName} - ` : ''}${s.label}, ~${s.distanceKm}km`);
    }
    if (pd.landOwnership?.titles?.length) {
      const names = pd.landOwnership.titles.flatMap((t) => t.proprietors.map((p) => p.name));
      const unique = Array.from(new Set(names)).slice(0, 5);
      if (unique.length) push('Corporate owners at postcode (HMLR)', unique.join('; '));
    }
    if (pd.broadband) {
      const b = pd.broadband;
      const parts = [
        b.maxDownloadMbps != null ? `max ${b.maxDownloadMbps} Mbit/s` : null,
        b.fullFibrePct != null ? `full fibre ${b.fullFibrePct.toFixed(0)}%` : null,
      ].filter(Boolean);
      if (parts.length) push('Broadband (Ofcom)', parts.join(', '));
    }
    if (pd.boundary?.inspireId) push('Plot boundary', 'HMLR INSPIRE freehold boundary on file');
    if (pd.planning) {
      if (pd.planning.conservationArea) lines.push('In a conservation area.');
      if (pd.planning.listed) lines.push('Listed building designation present.');
    }
    if (pd.schools?.length) {
      lines.push('Nearest schools:');
      pd.schools.slice(0, 4).forEach((s) =>
        lines.push(`  - ${s.name} (${s.type})${s.ofstedRating ? `, Ofsted ${s.ofstedRating}` : ''}, ${s.distanceMi}mi`)
      );
    }
    if (pd.planningApplications?.length) {
      const newHomes = pd.planningApplications.filter((a) => a.residential);
      if (newHomes.length) {
        lines.push(`Nearby residential planning applications: ${newHomes.length}` +
          (newHomes.some((a) => a.units) ? ` (up to ${Math.max(...newHomes.map((a) => a.units || 0))} units in one scheme)` : ''));
      }
    }
  }

  if (deal.location?.crime) {
    const c = deal.location.crime;
    push('Crime', `${c.total12mo} incidents/12mo, ${c.per1000} per 1000, ${c.comparison} than district avg`);
  }
  if (deal.location?.amenities?.length) {
    lines.push('Key amenities:');
    deal.location.amenities.slice(0, 6).forEach((a) =>
      lines.push(`  - ${a.name} (${a.category}): ${a.distanceText}, ~${a.travelMinutes}min ${a.mode}`)
    );
  }

  heading('Offer');
  push('Recommended offer (£)', deal.offer.recommended);
  push('Strategy notes', deal.offer.strategy);

  return lines.join('\n').trim();
}
