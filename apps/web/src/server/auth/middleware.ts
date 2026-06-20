import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresh the Supabase auth session on every request and return the current
 * user. Called from the root middleware.ts.
 *
 * Reference: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Fail soft when env not configured: marketing landing and login still render.
  // Provisioning (M0-T2) makes these present; until then, no session refresh.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { response, user: null };
  }

  let res = response;
  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          res = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient() and getUser().
  // A simple mistake here can cause auth issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response: res, user };
}
