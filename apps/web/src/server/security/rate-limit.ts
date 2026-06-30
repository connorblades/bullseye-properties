/**
 * Best-effort in-memory fixed-window rate limiter (M4-T5).
 *
 * Protects the unauthenticated public share surfaces (/o, /r and their PDF
 * routes) from abuse and from cheap enumeration of the expensive PDF render.
 * State is per-runtime-instance (no shared store), so it is a first layer, not
 * a hard guarantee across a horizontally-scaled deployment. The production
 * upgrade is a shared store (e.g. Upstash Redis) behind the same interface.
 *
 * Edge-safe: no Node APIs, no timers. `now` is injected for testability.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    // Opportunistic cleanup of expired buckets when the map grows large,
    // since there is no timer to evict them.
    if (buckets.size > MAX_TRACKED) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count), retryAfterMs: 0 };
}

/** Test-only: clear all tracked buckets. */
export function __resetRateLimits(): void {
  buckets.clear();
}
