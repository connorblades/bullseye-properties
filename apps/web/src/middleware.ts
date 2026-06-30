import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/server/auth/middleware';
import { rateLimit } from '@/server/security/rate-limit';

/** Per-IP cap on the unauthenticated public share surfaces (M4-T5). */
const SHARE_RATE_LIMIT = 60;
const SHARE_RATE_WINDOW_MS = 60_000;

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Middleware: rate-limit the public share surfaces, refresh the auth session on
 * every request, and gate protected routes. Unauthenticated requests to gated
 * routes redirect to /login.
 *
 * Reference: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Token-gated public delivery surfaces (outline + report, incl. their PDF
  // routes). Rate-limit per IP before any DB work or PDF render can run, then
  // let the request through - access is gated by the share token itself, not
  // by an auth session.
  const isShareSurface = path.startsWith('/o/') || path.startsWith('/r/');
  if (isShareSurface) {
    const rl = rateLimit(`share:${clientIp(request)}`, SHARE_RATE_LIMIT, SHARE_RATE_WINDOW_MS, Date.now());
    if (!rl.ok) {
      return new NextResponse('Too many requests. Please slow down and try again shortly.', {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)), 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.next({ request });
  }

  const { response, user } = await updateSession(request);

  const isPublic =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    path.startsWith('/_next') ||
    path.startsWith('/api/public');

  // Local dev fail-soft: when Supabase env vars are not yet set (M0 cloud
  // provisioning still pending), don't gate routes — the wizard is reachable
  // from localhost so M1 can be built and previewed before M0 is closed.
  // Once NEXT_PUBLIC_SUPABASE_URL is present, full auth gating is restored.
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  if (supabaseConfigured && !user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (path === '/login' || path === '/login/sent')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico, robots.txt, sitemap.xml
     * - assets in /public served by the static handler
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|pdf)$).*)',
  ],
};
