import { timingSafeEqual } from 'node:crypto';
import { ingestCandidatesForTenant } from '@/server/actions/lead-review';
import { validateCandidateBatch, FEEDER_CONTRACT_VERSION } from '@/lib/feeder-contract';

/**
 * Machine ingress for the external scraper (M5, Stage 5).
 *
 * POST { tenantId, candidates: ScrapedCandidate[] } authenticated with a shared
 * bearer token (LEAD_INGEST_TOKEN). Machine-to-machine: no user session, so it
 * does NOT go through requireTenant - the caller names the tenant explicitly.
 *
 * The actual normalise / fit / dedupe / insert is delegated to the shared
 * `ingestCandidatesForTenant`, so this path dedupes against BOTH the pending
 * queue and existing deals (re-posting the same listings is idempotent) - the
 * same logic the in-session ingest uses. It does NOT enrich or create deals; a
 * partner reviews the queue and promotes survivors via approveCandidate().
 *
 * Returns { inserted, skipped, errors }.
 */

export const runtime = 'nodejs';

/** Constant-time compare of two strings; false on any length mismatch. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws if the buffers differ in length, so guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the bearer token out of an Authorization header, or null. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.LEAD_INGEST_TOKEN;
  if (!expected) {
    return Response.json({ error: 'Ingest is not configured.' }, { status: 503 });
  }

  const provided = bearerToken(req);
  if (!provided || !tokensMatch(provided, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { tenantId, candidates } =
    (body as { tenantId?: unknown; candidates?: unknown }) ?? {};

  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    return Response.json({ error: 'tenantId is required.' }, { status: 400 });
  }
  if (!Array.isArray(candidates)) {
    return Response.json({ error: 'candidates must be an array.' }, { status: 400 });
  }

  // Validate each item against the feeder contract BEFORE ingest, so a malformed
  // listing is rejected with a clear per-item reason (never silently mangled).
  // Accepted items proceed; rejects are reported alongside any ingest errors.
  const { valid, invalid } = validateCandidateBatch(candidates);
  const summary = await ingestCandidatesForTenant(tenantId, valid);

  return Response.json({
    ...summary,
    skipped: summary.skipped + invalid.length,
    errors: [
      ...summary.errors,
      ...invalid.map((v) => ({ address: v.address, reason: `candidates[${v.index}]: ${v.reason}` })),
    ],
    contractVersion: FEEDER_CONTRACT_VERSION,
  });
}
