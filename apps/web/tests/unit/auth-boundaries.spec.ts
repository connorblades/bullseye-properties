import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const auth = vi.hoisted(() => ({
  updateSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));
vi.mock('@/server/auth/middleware', () => ({ updateSession: auth.updateSession }));
vi.mock('@/server/auth/server', () => ({
  createSupabaseRouteClient: () => ({ auth: { exchangeCodeForSession: auth.exchangeCodeForSession } }),
}));

import { middleware, isPublicPath } from '@/middleware';
import { GET } from '@/app/auth/callback/route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.bpos.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  auth.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('protected routes fail closed', () => {
  it.each(['/dashboard', '/review', '/api/deal/x/report-stream'])('requires sign-in at %s with missing configuration', async (path) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const response = await middleware(new NextRequest(`https://bpos.test${path}`));
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('next')).toBe(path);
  });

  it.each(['/login-extra', '/authentic', '/api/public-private', '/api/leads/ingest-other'])('does not allow a prefix lookalike: %s', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it('continues an authenticated request', async () => {
    auth.updateSession.mockResolvedValue({ response: NextResponse.next(), user: { id: 'user-1' } });
    const response = await middleware(new NextRequest('https://bpos.test/dashboard'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('sign-in callback stays on this application', () => {
  it('returns to login when the account connection is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const response = await GET(new NextRequest('https://bpos.test/auth/callback?code=test-code'));
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('error')).toContain('not connected');
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('handles a rejected provider request without a server exception', async () => {
    auth.exchangeCodeForSession.mockRejectedValue(new Error('connection refused'));
    const response = await GET(new NextRequest('https://bpos.test/auth/callback?code=test-code'));
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });

  it.each(['@attacker.test', '//attacker.test', '/\\attacker.test', 'https://attacker.test', '/\t/attacker.test', 'javascript:alert(1)'])('rejects %j', async (next) => {
    const url = new URL('https://bpos.test/auth/callback');
    url.searchParams.set('code', 'test-code');
    url.searchParams.set('next', next);
    const response = await GET(new NextRequest(url));
    expect(response.headers.get('location')).toBe('https://bpos.test/dashboard');
  });

  it('preserves a valid internal path and query', async () => {
    const response = await GET(new NextRequest('https://bpos.test/auth/callback?code=test-code&next=%2Freview%3Fsource%3Dauction'));
    expect(response.headers.get('location')).toBe('https://bpos.test/review?source=auction');
  });

  it('does not redirect to the requested destination when code exchange fails', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('expired') });
    const response = await GET(new NextRequest('https://bpos.test/auth/callback?code=expired&next=%2Freview'));
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});
