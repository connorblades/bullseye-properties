import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/leads/ingest/route';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * Machine-ingress auth + validation gate (AC-13: a missing or incorrect ingress
 * token returns 401). Every path asserted here returns before any DB write, so
 * the suite needs no database - it exercises the token check and body validation
 * only. The happy insert path is a staging test (needs the lead_candidates
 * table), covered by the M7 staging checklist.
 */

const TOKEN = 'test-ingest-token';

function makeReq(body: unknown, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://test/api/leads/ingest', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/leads/ingest - auth and validation', () => {
  it('503 when LEAD_INGEST_TOKEN is not configured', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', '');
    const res = await POST(makeReq({ tenantId: 't', candidates: [] }, TOKEN));
    expect(res.status).toBe(503);
  });

  it('401 when the Authorization header is missing', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq({ tenantId: 't', candidates: [] }));
    expect(res.status).toBe(401);
  });

  it('401 on a wrong bearer token of equal length', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq({ tenantId: 't', candidates: [] }, 'wrong-ingest-tokn'));
    expect(res.status).toBe(401);
  });

  it('401 on a token of a different length (constant-time guard)', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq({ tenantId: 't', candidates: [] }, 'x'));
    expect(res.status).toBe(401);
  });

  it('400 on an invalid JSON body', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq('not-json', TOKEN));
    expect(res.status).toBe(400);
  });

  it('400 when tenantId is missing', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq({ candidates: [] }, TOKEN));
    expect(res.status).toBe(400);
  });

  it('400 when candidates is not an array', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(makeReq({ tenantId: 't', candidates: 'nope' }, TOKEN));
    expect(res.status).toBe(400);
  });

  it('200 with zero inserted for an authorised empty batch (no DB write)', async () => {
    vi.stubEnv('LEAD_INGEST_TOKEN', TOKEN);
    const res = await POST(
      makeReq({ tenantId: 't', candidates: [] as ScrapedCandidate[] }, TOKEN)
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ inserted: 0, skipped: 0, errors: [], results: [] });
  });
});
