/**
 * Server-only VOA council-tax band scraper (supporting info).
 *
 * The Valuation Office Agency publishes no JSON API; council-tax bands live
 * behind the gov.uk "Check your Council Tax band" service, which is a
 * session + CSRF HTML flow. This scraper drives that flow best-effort and is
 * AGGRESSIVELY fail-soft: any change to the page shape yields null and the
 * wizard falls back to a manual band field. It is the most fragile integration
 * in M2 by design (BUILD §M2 names no council-tax source); expect occasional
 * maintenance. Cached 30 days per postcode.
 *
 * Because fetch() does not persist cookies across calls, this module handles
 * Set-Cookie and the 303 redirect manually rather than using ./http.
 */

import type { CouncilTaxInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { failSoft } from './http';

const BASE = 'https://www.tax.service.gov.uk/check-council-tax-band';
const UA = 'BullseyePlatform/1.0 (+https://os.bullseyeproperties.co.uk)';

function extract(re: RegExp, html: string): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

/** Leading house number / PAON from a free-text address, for row matching. */
function leadingPaon(address: string): string | null {
  const m = address.match(/^\s*(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : null;
}

async function timedFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

/** Parse the results table into [addressText, band] pairs. Best-effort. */
function parseBands(html: string): { address: string; band: string }[] {
  const rows: { address: string; band: string }[] = [];
  // Each result row pairs an address cell with a single-letter band cell.
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(html))) {
    cells.push(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  for (let i = 0; i < cells.length - 1; i++) {
    const bandMatch = cells[i + 1].match(/^([A-H])$/);
    if (cells[i] && bandMatch && /\d/.test(cells[i])) {
      rows.push({ address: cells[i], band: bandMatch[1] });
    }
  }
  return rows;
}

function modalBand(rows: { band: string }[]): string | null {
  if (rows.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.band, (counts.get(r.band) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export async function fetchCouncilTax(postcode: string, address: string): Promise<CouncilTaxInfo | null> {
  const key = `councilTax:${postcode}`;
  return cached(key, 'councilTax', TTL.month, () =>
    failSoft('council-tax', async () => {
      // 1. GET the search form: obtain the session cookie + CSRF token.
      const formRes = await timedFetch(`${BASE}/search`, { headers: { 'user-agent': UA } });
      const cookie = (formRes.headers.get('set-cookie') ?? '')
        .split(/,(?=[^;]+?=)/)
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
      const formHtml = await formRes.text();
      const csrf = extract(/name="csrfToken"[^>]*value="([^"]+)"/, formHtml);
      if (!csrf || !cookie) throw new Error('VOA form token/cookie not found');

      // 2. POST the postcode. Manual redirect handling (303 -> results).
      const postRes = await timedFetch(`${BASE}/search-results`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'user-agent': UA,
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
        },
        body: new URLSearchParams({ csrfToken: csrf, 'council-tax-postcode': postcode, postcode }).toString(),
      });

      let resultsHtml: string;
      if (postRes.status >= 300 && postRes.status < 400) {
        const loc = postRes.headers.get('location');
        if (!loc) throw new Error('VOA redirect missing location');
        const resultsUrl = loc.startsWith('http') ? loc : `https://www.tax.service.gov.uk${loc}`;
        const resultsRes = await timedFetch(resultsUrl, { headers: { 'user-agent': UA, cookie } });
        resultsHtml = await resultsRes.text();
      } else {
        resultsHtml = await postRes.text();
      }

      const rows = parseBands(resultsHtml);
      if (rows.length === 0) throw new Error('VOA results unparseable');

      // Prefer the row whose address starts with the deal's house number.
      const paon = leadingPaon(address);
      const exact = paon
        ? rows.find((r) => r.address.toLowerCase().split(/\s+/).includes(paon))
        : undefined;
      const band = exact?.band ?? modalBand(rows);
      if (!band) throw new Error('VOA band not resolved');

      return {
        band,
        source: exact ? 'VOA (matched address)' : 'VOA (postcode typical band)',
      } satisfies CouncilTaxInfo;
    }),
  );
}
