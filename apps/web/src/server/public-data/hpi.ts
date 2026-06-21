/**
 * Server-only UK House Price Index integration (M2-T1).
 *
 * Land Registry publishes the UKHPI as linked data; we query the SPARQL
 * endpoint for the property's local authority. Each UKHPI region has a URI of
 * the form .../id/region/{slug} where slug is the lower-cased, hyphenated
 * district name (e.g. "Mansfield" -> "mansfield"); postcodes.io gives us that
 * district name.
 *
 * Returns the monthly index series (used to adjust sales comps from their
 * sold-month index to the current-month index) plus the 10-year compound
 * annual growth (used to seed the default capital-growth assumption).
 *
 * Cached 24h per (district, latest-month). Fully fail-soft.
 */

import type { HpiInfo, HpiPoint } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

type SparqlBinding = {
  month: { value: string };
  index: { value: string };
  avg: { value: string };
};
type SparqlResults = { results: { bindings: SparqlBinding[] } };

/** "Mansfield" -> "mansfield"; "Kingston upon Thames" -> "kingston-upon-thames". */
export function regionSlug(district: string): string {
  return district
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildQuery(slug: string): string {
  const region = `http://landregistry.data.gov.uk/id/region/${slug}`;
  // Last 11 years (132 months), newest first, reversed to ascending below.
  return `PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
SELECT ?month ?index ?avg WHERE {
  ?o ukhpi:refRegion <${region}> ;
     ukhpi:refMonth ?month ;
     ukhpi:housePriceIndex ?index ;
     ukhpi:averagePrice ?avg .
} ORDER BY DESC(?month) LIMIT 132`;
}

/** 10-year compound annual growth from the index series, as a percentage. */
function computeCagr10yr(series: HpiPoint[]): number {
  if (series.length < 2) return 0;
  const latest = series[series.length - 1];
  // 120 months back, or the oldest point we have if the series is shorter.
  const targetIdx = Math.max(0, series.length - 1 - 120);
  const past = series[targetIdx];
  const years = (series.length - 1 - targetIdx) / 12;
  if (past.index <= 0 || years <= 0) return 0;
  const cagr = Math.pow(latest.index / past.index, 1 / years) - 1;
  return cagr * 100;
}

export async function fetchHpi(district: string, districtCode: string): Promise<HpiInfo | null> {
  const slug = regionSlug(district);
  const key = `hpi:${slug}`;
  return cached(key, 'hpi', TTL.day, () =>
    failSoft('hpi', async () => {
      const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(buildQuery(slug))}`;
      const data = await fetchJson<SparqlResults>(url, {
        headers: { Accept: 'application/sparql-results+json' },
        timeoutMs: 25_000,
      });
      const bindings = data.results?.bindings ?? [];
      if (bindings.length === 0) throw new Error(`no HPI for region "${slug}"`);

      // SPARQL returned newest-first; reverse to ascending.
      const series: HpiPoint[] = bindings
        .map((b) => ({ month: b.month.value, index: parseFloat(b.index.value) }))
        .filter((p) => Number.isFinite(p.index))
        .reverse();

      const latestBinding = bindings[0];
      const latest = series[series.length - 1];

      return {
        district,
        districtCode,
        latestMonth: latest.month,
        latestIndex: latest.index,
        latestAvgPrice: Math.round(parseFloat(latestBinding.avg.value)) || 0,
        cagr10yrPct: Math.round(computeCagr10yr(series) * 100) / 100,
        series,
      } satisfies HpiInfo;
    }),
  );
}
