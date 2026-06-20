import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { CookieOptions } from '@supabase/ssr';

/**
 * Supabase clients for Server Components, Server Actions, and Route Handlers.
 *
 * Three flavours:
 *  - createSupabaseServerClient()  - for Server Components (reads cookies only)
 *  - createSupabaseActionClient()  - for Server Actions (read + write cookies)
 *  - createSupabaseRouteClient()   - for Route Handlers (read + write cookies)
 *
 * The middleware refreshes the session cookie on every request, so these
 * clients can rely on a fresh JWT being available.
 *
 * Reference: https://supabase.com/docs/guides/auth/server-side/creating-a-client
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server Components can't set cookies; setAll is a no-op here.
          // The middleware handles refresh. The action/route clients can write.
        },
      },
    }
  );
}

export function createSupabaseActionClient() {
  const cookieStore = cookies();
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component invoked this; ignore. Middleware will refresh.
          }
        },
      },
    }
  );
}

export function createSupabaseRouteClient() {
  // Same shape as the action client. Kept separate for clarity / future divergence.
  return createSupabaseActionClient();
}

/**
 * Get the current authenticated user from the session cookie.
 * Returns null if not signed in or if Supabase env vars aren't configured yet.
 */
export async function getUser() {
  if (!supabaseConfigured()) return null;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Require an authenticated user. Redirects to /login if not signed in.
 * Use at the top of every Server Component that's behind auth.
 *
 * Local dev fail-soft: when Supabase env vars are not yet set (M0 cloud
 * provisioning pending), returns a stub user so local preview works.
 * Once env is configured, full auth gating is restored.
 */
export async function requireUser() {
  if (!supabaseConfigured()) {
    return {
      id: 'local-dev',
      email: 'local-dev@bullseyeproperties.co.uk',
      aud: 'local-dev',
    } as const;
  }
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}
