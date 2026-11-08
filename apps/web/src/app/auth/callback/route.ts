import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSupabaseRouteClient } from '@/server/auth/server';
import { signInDestination } from '@/server/auth/redirect';
import { authConfigured, AUTH_UNAVAILABLE } from '@/server/auth/config';

/**
 * Magic-link callback handler.
 *
 * Supabase Auth sends the user to this route with a `code` query param after
 * they click the link in their email. We exchange the code for a session
 * cookie and redirect them to the dashboard.
 *
 * Reference: https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!authConfigured()) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(AUTH_UNAVAILABLE)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Missing sign-in code.')}`);
  }

  let failed = true;
  try {
    const supabase = await createSupabaseRouteClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  } catch {
    // A disconnected provider must not turn an expired link into a 500 page.
  }

  if (failed) {
    const message = encodeURIComponent('That sign-in link has expired or already been used. Request a new one.');
    return NextResponse.redirect(`${origin}/login?error=${message}`);
  }

  return NextResponse.redirect(signInDestination(next, origin));
}
