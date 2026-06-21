/**
 * Server-only data.police.uk crime integration (M2-T2).
 *
 * The street-level API is point-and-radius only (~1 mile around the point) and
 * carries no population denominator, so an honest "per 1,000 population" figure
 * isn't derivable from it alone. Instead we report what the data genuinely
 * supports: the rolling 12-month incident total, a category breakdown, the
 * monthly average, and whether the latest month runs above or below that
 * average (a real local trend signal). The CrimeStats fields are reused with
 * that meaning; the CrimeProfile component labels them accordingly.
 *
 * Police data lags ~2 months, so we anchor on the latest month the API reports
 * as available rather than the calendar month. Cached 24h per (lat, lng,
 * latest-month). Fully fail-soft.
 */

import type { CrimeStats } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const DATES_URL = 'https://data.police.uk/api/crimes-street-dates';
const CRIME_URL = 'https://data.police.uk/api/crimes-street/all-crime';

type DateEntry = { date: string };
type CrimeRecord = { category: string };

function humanizeCategory(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The most recent N months the API reports data for, newest first. */
async function recentMonths(n: number): Promise<string[]> {
  const dates = await fetchJson<DateEntry[]>(DATES_URL);
  return dates.slice(0, n).map((d) => d.date);
}

export async function fetchCrime(lat: number, lng: number): Promise<CrimeStats | null> {
  return failSoft('crime', async () => {
    const months = await recentMonths(12);
    if (months.length === 0) throw new Error('no crime months available');
    const latestMonth = months[0];
    const key = `crime:${lat.toFixed(4)},${lng.toFixed(4)}:${latestMonth}`;

    return cached(key, 'crime', TTL.day, () =>
      failSoft('crime-fetch', async () => {
        // One call per month. Sequential to respect the 15 req/s limit and keep
        // it gentle on the public server; 12 calls complete in a few seconds.
        const byCategory = new Map<string, number>();
        const monthlyCounts: number[] = [];
        for (const month of months) {
          const url = `${CRIME_URL}?lat=${lat}&lng=${lng}&date=${month}`;
          const records = await fetchJson<CrimeRecord[]>(url);
          monthlyCounts.push(records.length);
          for (const r of records) {
            byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
          }
        }

        const total12mo = monthlyCounts.reduce((a, b) => a + b, 0);
        const monthlyAvg = total12mo / months.length;
        const latestCount = monthlyCounts[0];

        // Latest month vs the area's own 12-month average month: a local trend.
        const diffPct = monthlyAvg > 0 ? ((latestCount - monthlyAvg) / monthlyAvg) * 100 : 0;
        const comparison: CrimeStats['comparison'] =
          diffPct <= -10 ? 'lower' : diffPct >= 10 ? 'higher' : 'similar';
        const sign = diffPct >= 0 ? '+' : '';
        const comparisonPct = `${sign}${diffPct.toFixed(0)}% vs avg`;

        const breakdown = [...byCategory.entries()]
          .map(([category, count]) => ({ category: humanizeCategory(category), count }))
          .sort((a, b) => b.count - a.count);

        return {
          total12mo,
          per1000: monthlyAvg.toFixed(0),       // reused: average incidents / month
          districtAvg: String(latestCount),     // reused: latest month incident count
          comparison,
          comparisonPct,
          breakdown,
        } satisfies CrimeStats;
      }),
    );
  });
}
