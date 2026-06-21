/**
 * Server-only TTL cache backed by the `public_data_cache` table.
 *
 * One shared key/value store for every public-data source. The TTL lives in
 * each row's expires_at; callers pass the window from BUILD §7 per source
 * (HPI 24h, crime 24h, flood 30d, amenities 7d, geocode 30d, maps 30d).
 *
 * Reads are fail-soft: a cache miss or a DB hiccup returns null and the caller
 * re-fetches from source. Writes are best-effort: a failed write is logged but
 * never throws, so a cache outage degrades to "always fetch fresh" rather than
 * a hard error.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { publicDataCache } from '@/server/db/schema';

export type CacheSource =
  | 'geocode' | 'hpi' | 'crime' | 'flood' | 'amenities'
  | 'pricePaid' | 'planning' | 'planningApplications' | 'schools'
  | 'areaStats' | 'airQuality'
  | 'councilTax' | 'epc' | 'companies' | 'deprivation' | 'maps';

export const TTL = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

/** Read a fresh (non-expired) cached payload, or null on miss/expiry/error. */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const rows = await db
      .select({ payload: publicDataCache.payload, expiresAt: publicDataCache.expiresAt })
      .from(publicDataCache)
      .where(eq(publicDataCache.cacheKey, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row.payload as T;
  } catch (e) {
    console.warn('[public-data] cache read failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Upsert a payload with a TTL. Best-effort: never throws. */
export async function setCached<T>(
  key: string,
  source: CacheSource,
  payload: T,
  ttlMs: number,
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await db
      .insert(publicDataCache)
      .values({ cacheKey: key, source, payload: payload as unknown, fetchedAt: now, expiresAt })
      .onConflictDoUpdate({
        target: publicDataCache.cacheKey,
        set: { payload: payload as unknown, source, fetchedAt: now, expiresAt },
      });
  } catch (e) {
    console.warn('[public-data] cache write failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Fetch-through cache: return the cached value if fresh, otherwise run `fetcher`,
 * cache its result, and return it. If `fetcher` returns null (source down), the
 * miss is NOT cached — the next call retries the source.
 */
export async function cached<T>(
  key: string,
  source: CacheSource,
  ttlMs: number,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  const hit = await getCached<T>(key);
  if (hit !== null) return hit;
  const fresh = await fetcher();
  if (fresh !== null) await setCached(key, source, fresh, ttlMs);
  return fresh;
}
