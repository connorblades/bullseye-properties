/**
 * Server-only EPC integration (supporting info, keyed).
 *
 * Uses the MHCLG "Get energy performance of buildings data" service, which
 * replaced the retired epc.opendatacommunities.org API (shut 30 May 2026). Auth
 * is a single Bearer token (EPC_API_TOKEN) - no email/Basic any more. Without
 * the token the fetcher returns null and the source reports "unavailable".
 *
 * Two calls: search the postcode for the matching certificate, then fetch that
 * certificate's full detail (potential rating, floor area, heating, etc). The
 * search response is camelCase; the detail response is snake_case (the upstream
 * service is inconsistent - both shapes are handled here). Cached 30 days per
 * postcode. We pick the certificate matching the property's house number where
 * possible, else the most recently registered in the postcode.
 */

import type { EpcInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const API_BASE = 'https://api.get-energy-performance-data.communities.gov.uk/api';

type SearchRow = {
  certificateNumber: string;
  addressLine1?: string;
  postcode?: string;
  currentEnergyEfficiencyBand?: string;
  registrationDate?: string;
};
type SearchResponse = { data?: SearchRow[] };

type HeatingEntry = { description?: string };
type CertDetail = {
  data?: CertDetail;
  current_energy_efficiency_band?: string;
  potential_energy_efficiency_band?: string;
  energy_rating_current?: number;
  energy_rating_potential?: number;
  total_floor_area?: number;
  dwelling_type?: string;
  built_form?: number | string;
  main_heating?: HeatingEntry[];
  registration_date?: string;
  address_line_1?: string;
  post_town?: string;
};

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

export async function fetchEpc(postcode: string, address: string): Promise<EpcInfo | null> {
  const t = token();
  if (!t) return null; // key not configured - fail soft

  const key = `epc:${postcode}`;
  return cached(key, 'epc', TTL.month, () =>
    failSoft('epc', async () => {
      // 1. Search the postcode for candidate certificates.
      const searchUrl = `${API_BASE}/domestic/search?postcode=${encodeURIComponent(postcode)}&page_size=100`;
      const search = await fetchJson<SearchResponse>(searchUrl, { headers: authHeaders(t) });
      const rows = search.data ?? [];
      if (rows.length === 0) throw new Error('no EPC records');

      const paon = leadingPaon(address);
      const matched =
        (paon && rows.find((r) => (r.addressLine1 ?? '').toLowerCase().split(/\s+/).includes(paon))) ||
        [...rows].sort((a, b) => ((a.registrationDate ?? '') < (b.registrationDate ?? '') ? 1 : -1))[0];

      // 2. Fetch that certificate's full detail.
      const detailUrl = `${API_BASE}/certificate?certificate_number=${encodeURIComponent(matched.certificateNumber)}`;
      const detailRes = await fetchJson<CertDetail>(detailUrl, { headers: authHeaders(t) });
      const d: CertDetail = (detailRes.data as CertDetail) ?? detailRes;

      return {
        currentRating: d.current_energy_efficiency_band ?? matched.currentEnergyEfficiencyBand ?? '',
        currentScore: d.energy_rating_current ?? 0,
        potentialRating: d.potential_energy_efficiency_band ?? '',
        potentialScore: d.energy_rating_potential ?? 0,
        floorAreaM2: typeof d.total_floor_area === 'number' ? d.total_floor_area : undefined,
        propertyType: d.dwelling_type,
        builtForm: undefined,
        ageBand: undefined,
        mainHeating: d.main_heating?.[0]?.description,
        lodgementDate: d.registration_date ?? matched.registrationDate,
        address: d.address_line_1 ?? matched.addressLine1,
      } satisfies EpcInfo;
    }),
  );
}
