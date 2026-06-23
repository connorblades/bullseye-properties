import type { Deal } from './deal-store';
import { computeFinancials, computeGrowthProjection, parseMoney } from './deal-calcs';
import { scoreLeadFit } from './lead-score';

/**
 * Outline deal pack (M5) - the light, pre-viewing teaser shared with a prospect
 * to gauge interest BEFORE any viewing or detailed due diligence. Pure +
 * client-safe; rendered both as a 1-page PDF and a public web page.
 */

export type OutlineData = {
  address: string;
  price: number | null;
  monthlyRent: number | null;
  grossYield: number;
  netYield: number;
  projected5yr: number | null;
  fitPct: number;
  fitMet: number;
  fitApplicable: number;
  matched: string[];   // criteria the property meets
  highlights: string[]; // light location highlights (no deep DD)
  recommendation: string;
  images: { src: string; caption?: string }[]; // up to 2 pre-viewing visuals (area map / context shots)
};

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');

/** The data-led recommendation + invite shown to the client. */
export function outlineRecommendation(deal: Deal): string {
  const fit = scoreLeadFit(deal);
  const fin = computeFinancials(deal);
  const matched = fit.reasons.filter((r) => r.ok).map((r) => r.text.toLowerCase());

  if (fit.applicable > 0 && fit.met > 0) {
    const clause = matched.length ? `: ${matched.join(', ')}` : '';
    return `This matches ${fit.met} of ${fit.applicable} of your criteria${clause}. On paper it's a strong fit. Shall I arrange a viewing and run the full due diligence?`;
  }
  if (fin.grossYield > 0) {
    return `On the numbers this looks worth a closer look (around ${fin.grossYield.toFixed(1)}% gross yield). Shall I arrange a viewing and run the full due diligence?`;
  }
  return 'This one looks worth a closer look. Shall I arrange a viewing and run the full due diligence?';
}

export function buildOutline(deal: Deal): OutlineData {
  const fin = computeFinancials(deal);
  const fit = scoreLeadFit(deal);
  const price = parseMoney(deal.financials.purchasePrice) ?? parseMoney(deal.property.askingPrice);
  const monthlyRent = parseMoney(deal.financials.monthlyRent);

  let projected5yr: number | null = null;
  try {
    const proj = computeGrowthProjection(deal);
    projected5yr = proj.exit5?.propertyValue ?? null;
  } catch {
    /* needs numeric inputs */
  }

  const pd = deal.publicData;
  const highlights: string[] = [];
  const area = pd?.areaStats?.areaName || pd?.district || deal.criteria.areas;
  if (area) highlights.push(`Location: ${area}`);
  if (pd?.hpi) highlights.push(`Local prices up ~${pd.hpi.cagr10yrPct}% a year over 10 years (Land Registry HPI)`);
  if (pd?.areaStats?.employmentRate) highlights.push(`Local employment rate ${pd.areaStats.employmentRate}%`);
  if (deal.location?.crime?.comparison) highlights.push(`Crime ${deal.location.crime.comparison} than the district average`);
  const goodSchool = pd?.schools?.find((s) => /good|outstanding/i.test(s.ofstedRating ?? ''));
  if (goodSchool) highlights.push(`${goodSchool.ofstedRating}-rated school nearby (${goodSchool.name}, ${goodSchool.distanceMi}mi)`);
  const transport = deal.location?.amenities?.find((a) => a.category === 'transport');
  if (transport) highlights.push(`${transport.name}: ${transport.distanceText}`);

  // Pre-viewing visuals only: the area map and any context shots uploaded at
  // Auto-Pull. No interior/condition photos (those come from the viewing).
  const images: { src: string; caption?: string }[] = [];
  if (deal.location?.mapImage) images.push({ src: deal.location.mapImage, caption: 'Area map' });
  for (const ci of deal.location?.contextImages ?? []) {
    if (ci.imageData) images.push({ src: ci.imageData, caption: ci.caption || undefined });
  }

  return {
    address: deal.address,
    price,
    monthlyRent,
    grossYield: fin.grossYield,
    netYield: fin.netYield,
    projected5yr,
    fitPct: fit.pct,
    fitMet: fit.met,
    fitApplicable: fit.applicable,
    matched: fit.reasons.filter((r) => r.ok).map((r) => r.text),
    highlights: highlights.slice(0, 5),
    recommendation: outlineRecommendation(deal),
    images: images.slice(0, 2),
  };
}

export const fmtOutlineGBP = gbp;
