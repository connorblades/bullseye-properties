/**
 * Server-only Land Registry Price Paid integration (supporting info).
 *
 * Actual recorded sales for the postcode - the ground truth behind the HPI
 * index. Surfaced as real comparable transactions on the deal. Uses the Land
 * Registry structured-data API (no key). Cached 24h per postcode. Fail-soft.
 */

import type { PricePaidInfo, PricePaidTxn } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const PPI_URL = 'https://landregistry.data.gov.uk/data/ppi/transaction-record.json';

type PpiItem = {
  pricePaid?: number;
  transactionDate?: string;
  newBuild?: boolean;
  estateType?: { prefLabel?: { _value: string }[]; label?: { _value: string }[] };
  propertyType?: { prefLabel?: { _value: string }[]; label?: { _value: string }[] };
  propertyAddress?: {
    paon?: string;
    street?: string;
    postcode?: string;
  };
};
type PpiResponse = { result?: { items?: PpiItem[] } };

function pickLabel(l?: { prefLabel?: { _value: string }[]; label?: { _value: string }[] }): string {
  return l?.prefLabel?.[0]?._value ?? l?.label?.[0]?._value ?? '';
}

/** Normalise Land Registry's verbose propertyType label to a short form. */
function shortType(label: string): string {
  const t = label.toLowerCase();
  if (t.includes('detached') && !t.includes('semi')) return 'Detached';
  if (t.includes('semi')) return 'Semi-detached';
  if (t.includes('terrac')) return 'Terraced';
  if (t.includes('flat') || t.includes('maisonette')) return 'Flat';
  return label || 'Other';
}

export async function fetchPricePaid(postcode: string): Promise<PricePaidInfo | null> {
  const key = `pricePaid:${postcode}`;
  return cached(key, 'pricePaid', TTL.day, () =>
    failSoft('price-paid', async () => {
      const url =
        `${PPI_URL}?propertyAddress.postcode=${encodeURIComponent(postcode)}` +
        `&_pageSize=40&_sort=-transactionDate`;
      const data = await fetchJson<PpiResponse>(url);
      const items = data.result?.items ?? [];
      const transactions: PricePaidTxn[] = items
        .filter((i) => typeof i.pricePaid === 'number' && i.transactionDate)
        .map((i) => ({
          date: i.transactionDate as string,
          price: i.pricePaid as number,
          paon: i.propertyAddress?.paon ?? '',
          street: i.propertyAddress?.street ?? '',
          postcode: i.propertyAddress?.postcode ?? postcode,
          propertyType: shortType(pickLabel(i.propertyType)),
          newBuild: Boolean(i.newBuild),
          tenure: pickLabel(i.estateType) || 'Unknown',
        }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

      if (transactions.length === 0) throw new Error('no price-paid records');
      return { postcode, transactions } satisfies PricePaidInfo;
    }),
  );
}
