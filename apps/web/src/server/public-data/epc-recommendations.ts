/**
 * EPC improvement recommendations (M6-T2).
 *
 * Pulls the EPC measures + indicative costs for a property from the MHCLG "Get
 * energy performance of buildings data" service, and summarises the works +
 * cost needed to reach a target band (default C) via the pure logic in
 * lib/epc-grants.ts. Feeds the refurb estimate and the report (M6-T5).
 *
 * Fail-soft like every other public-data source: no token, no match, or an
 * unexpected shape returns null and the caller reports "unavailable". The exact
 * recommendations endpoint path is best-effort against the current service and
 * may need adjusting once verified live (comment below).
 */

import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';
import { summariseGrantWorks, type EpcMeasure, type GrantWorks } from '@/lib/epc-grants';

const API_BASE = 'https://api.get-energy-performance-data.communities.gov.uk/api';

type SearchRow = {
  certificateNumber: string;
  addressLine1?: string;
  currentEnergyEfficiencyBand?: string;
  registrationDate?: string;
};
type SearchResponse = { data?: SearchRow[] };

// Recommendations rows are read defensively - the upstream service mixes
// snake_case and camelCase, so several key spellings are accepted per field.
type RecRow = {
  improvement_summary_text?: string;
  improvementSummary?: string;
  improvement_descr_text?: string;
  improvementDescription?: string;
  indicative_cost?: string;
  indicativeCost?: string;
  energy_performance_band_improvement?: string;
  energyPerformanceBandImprovement?: string;
};
type RecResponse = { data?: RecRow[] };

function token(): string | null {
  return process.env.EPC_API_TOKEN || null;
}
function authHeaders(t: string) {
  return { Authorization: `Bearer ${t}`, Accept: 'application/json' };
}
function leadingPaon(address: string): string | null {
  const m = address.match(/^\s*(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function mapRow(r: RecRow): EpcMeasure {
  return {
    summary: r.improvement_summary_text ?? r.improvementSummary ?? 'Improvement measure',
    description: r.improvement_descr_text ?? r.improvementDescription,
    indicativeCostText: r.indicative_cost ?? r.indicativeCost,
    resultingBand: r.energy_performance_band_improvement ?? r.energyPerformanceBandImprovement,
  };
}

export async function fetchEpcRecommendations(
  postcode: string,
  address: string,
  target = 'C',
): Promise<GrantWorks | null> {
  const t = token();
  if (!t) return null;

  const key = `epc-rec:${postcode}:${target}`;
  return cached(key, 'epc', TTL.month, () =>
    failSoft('epc', async () => {
      // 1. Find the matching certificate (same match rule as fetchEpc).
      const searchUrl = `${API_BASE}/domestic/search?postcode=${encodeURIComponent(postcode)}&page_size=100`;
      const search = await fetchJson<SearchResponse>(searchUrl, { headers: authHeaders(t) });
      const rows = search.data ?? [];
      if (rows.length === 0) throw new Error('no EPC records');

      const paon = leadingPaon(address);
      const matched =
        (paon && rows.find((r) => (r.addressLine1 ?? '').toLowerCase().split(/\s+/).includes(paon))) ||
        [...rows].sort((a, b) => ((a.registrationDate ?? '') < (b.registrationDate ?? '') ? 1 : -1))[0];

      // 2. Fetch that certificate's recommendations.
      const recUrl = `${API_BASE}/recommendations?certificate_number=${encodeURIComponent(matched.certificateNumber)}`;
      const recRes = await fetchJson<RecResponse>(recUrl, { headers: authHeaders(t) });
      const measures = (recRes.data ?? []).map(mapRow);

      const currentBand = matched.currentEnergyEfficiencyBand ?? '';
      return summariseGrantWorks(currentBand, measures, target);
    }),
  );
}
