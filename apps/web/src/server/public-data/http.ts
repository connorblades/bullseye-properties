/**
 * Server-only module (imported only by Server Actions / other server modules,
 * matching the convention used across src/server). Do not import from a Client
 * Component.
 *
 * Fail-soft HTTP helpers for the public-data integrations.
 *
 * Every external source in M2 (Land Registry SPARQL, data.police.uk, the
 * Environment Agency, OSM Overpass, OSRM) is a free public endpoint with no
 * SLA. The platform must degrade gracefully — a flaky source surfaces as
 * "data unavailable" in the UI, never as a 500. These helpers centralise the
 * timeout + single-retry + swallow-and-return-null behaviour so each fetcher
 * stays small.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

export class PublicDataError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PublicDataError';
  }
}

type FetchOpts = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
};

/**
 * fetch with an AbortController timeout. Throws PublicDataError on non-2xx or
 * network failure so callers can decide whether to retry or fall through to a
 * fail-soft default.
 */
async function fetchOnce(url: string, opts: FetchOpts): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'user-agent': 'BullseyePlatform/1.0 (+https://os.bullseyeproperties.co.uk)',
        ...opts.headers,
      },
      body: opts.body,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new PublicDataError(`HTTP ${res.status} for ${url}`);
    }
    return res;
  } catch (e) {
    if (e instanceof PublicDataError) throw e;
    throw new PublicDataError(`Request failed for ${url}`, e);
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch JSON with one retry on failure. Throws PublicDataError if all attempts fail. */
export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(url, opts);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new PublicDataError(`fetchJson exhausted retries for ${url}`, lastErr);
}

/** Fetch text (used for SPARQL CSV/JSON responses where we control the Accept). */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(url, opts);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new PublicDataError(`fetchText exhausted retries for ${url}`, lastErr);
}

/**
 * Run a fetcher and never throw — returns the result or null. The single point
 * where a source failure becomes a fail-soft null. Logs to the server console
 * (picked up by Vercel logs / Sentry) so flaky sources are still observable.
 */
export async function failSoft<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[public-data] ${label} unavailable:`, e instanceof Error ? e.message : e);
    return null;
  }
}
