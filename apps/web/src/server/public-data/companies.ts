/**
 * Server-only Companies House integration (vendor due diligence, keyed).
 *
 * Companies House is NOT address-keyed, so this can't be part of the postcode
 * auto-pull. It's an on-demand vendor lookup: the sourcer enters a company name
 * or number on the deal, and we assemble a profile (status, incorporation,
 * registered office, SIC), officers, charge count and insolvency flag - the
 * things that matter when buying from a company or at auction.
 *
 * Auth is HTTP Basic with base64(apiKey + ':') - key as username, blank
 * password. Set COMPANIES_HOUSE_API_KEY (free at developer.company-information
 * .service.gov.uk). Cached 24h per company number. Fully fail-soft.
 */

import type { VendorCompany, CompanyOfficer } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const BASE = 'https://api.company-information.service.gov.uk';

type SearchResponse = { items?: { company_number: string; title: string }[] };
type Profile = {
  company_number: string;
  company_name: string;
  company_status?: string;
  type?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: Record<string, string>;
};
type OfficersResponse = {
  items?: {
    name: string;
    officer_role?: string;
    appointed_on?: string;
    resigned_on?: string;
  }[];
};
type ChargesResponse = { total_count?: number };
type InsolvencyResponse = { cases?: unknown[] };

function authHeader(): string | null {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) return null;
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function formatAddress(a?: Record<string, string>): string | undefined {
  if (!a) return undefined;
  return [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code]
    .filter(Boolean)
    .join(', ');
}

const COMPANY_NUMBER_RE = /^[A-Z0-9]{6,8}$/i;

/** Resolve a free-text query to a company number (direct or via search). */
async function resolveNumber(auth: string, query: string): Promise<string | null> {
  const trimmed = query.trim();
  if (COMPANY_NUMBER_RE.test(trimmed) && /\d/.test(trimmed)) {
    return trimmed.toUpperCase().padStart(8, '0');
  }
  const data = await fetchJson<SearchResponse>(
    `${BASE}/search/companies?q=${encodeURIComponent(trimmed)}&items_per_page=1`,
    { headers: { Authorization: auth } },
  );
  return data.items?.[0]?.company_number ?? null;
}

export async function lookupCompany(query: string): Promise<VendorCompany | null> {
  const auth = authHeader();
  if (!auth) return null; // key not configured

  return failSoft('companies-house', async () => {
    const number = await resolveNumber(auth, query);
    if (!number) throw new Error('no company match');

    const key = `companies:${number}`;
    return cached(key, 'companies', TTL.day, () =>
      failSoft('companies-house-profile', async () => {
        const headers = { Authorization: auth };
        const profile = await fetchJson<Profile>(`${BASE}/company/${number}`, { headers });

        const officersRes = await failSoft('ch-officers', () =>
          fetchJson<OfficersResponse>(`${BASE}/company/${number}/officers?items_per_page=35`, { headers }),
        );
        const officers: CompanyOfficer[] = (officersRes?.items ?? []).map((o) => ({
          name: o.name,
          role: o.officer_role ?? '',
          appointedOn: o.appointed_on,
          resignedOn: o.resigned_on,
        }));

        const chargesRes = await failSoft('ch-charges', () =>
          fetchJson<ChargesResponse>(`${BASE}/company/${number}/charges`, { headers }),
        );
        const insolvencyRes = await failSoft('ch-insolvency', () =>
          fetchJson<InsolvencyResponse>(`${BASE}/company/${number}/insolvency`, { headers }),
        );

        return {
          companyNumber: profile.company_number,
          companyName: profile.company_name,
          status: profile.company_status ?? 'unknown',
          type: profile.type,
          incorporatedOn: profile.date_of_creation,
          registeredOffice: formatAddress(profile.registered_office_address),
          sicCodes: profile.sic_codes,
          officers,
          chargesCount: chargesRes?.total_count ?? 0,
          hasInsolvency: (insolvencyRes?.cases?.length ?? 0) > 0,
        } satisfies VendorCompany;
      }),
    );
  });
}
