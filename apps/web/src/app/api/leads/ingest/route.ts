import { timingSafeEqual } from 'node:crypto';
import { ulid } from 'ulid';
import { db } from '@/server/db/client';
import { leadCandidates } from '@/server/db/schema';
import {
  normaliseCandidate,
  dedupeKey,
  fitForCandidate,
  type ScrapedCandidate,
} from '@/lib/lead-intake';

/**
 * Machine ingress for the external scraper (M5, Stage 5).
 *
 * POST { tenantId, candidates: ScrapedCandidate[] } authenticated with a shared
 * bearer token (LEAD_INGEST_TOKEN). This is machine-to-machine: there is no user
 * session, so it does NOT go through requireTenant - the caller names the tenant
 * explicitly and each candidate is queued as a `pending` lead_candidates row for
 * that tenant. It does NOT enrich and it does NOT create deals; a partner still
 * reviews the queue and promotes survivors via approveCandidate().
 *
 * Fail-soft per candidate: a bad candidate is recorded in `errors`/`results` and
 * the rest still land. Returns { inserted, skipped, errors, results }.
 *
 * The LEAD_INGEST_TOKEN env var is documented in the PR, not here.
 */

export const runtime = 'nodejs';

type CandidateResult = {
  address: string;
  status: 'inserted' | 'skipped' | 'error';
  id?: string;
  reason?: string;
};

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

  let inserted = 0;
  let skipped = 0;
  const errors: { address: string; reason: string }[] = [];
  const results: CandidateResult[] = [];

  // In-batch dedupe: a scraper can hand us the same listing twice in one call.
  const seen = new Set<string>();

  for (const raw of candidates as ScrapedCandidate[]) {
    const rawAddress = (raw && typeof raw.address === 'string' ? raw.address : '') || '(unknown)';
    try {
      const c = normaliseCandidate(raw);
      const key = dedupeKey(c);

      // A meaningless key (no postcode and no house number) can't be deduped
      // reliably; skip it rather than flooding the queue with collisions.
      if (key === ':' || key === '' || seen.has(key)) {
        skipped++;
        results.push({ address: c.address || rawAddress, status: 'skipped' });
        continue;
      }

      const fitPct = fitForCandidate(c);
      const id = `lc-${ulid()}`;

      await db.insert(leadCandidates).values({
        id,
        tenantId,
        status: 'pending',
        address: c.address || null,
        postcode: c.postcode ?? null,
        source: c.channel,
        fitPct,
        client: c.client ?? null,
        candidate: c as unknown as Record<string, unknown>,
        capturedFor: new Date().toISOString().slice(0, 10),
      });

      seen.add(key);
      inserted++;
      results.push({ address: c.address || rawAddress, status: 'inserted', id });
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown error';
      errors.push({ address: rawAddress, reason });
      results.push({ address: rawAddress, status: 'error', reason });
    }
  }

  return Response.json({ inserted, skipped, errors, results });
}
