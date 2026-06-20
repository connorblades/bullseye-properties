'use server';

import { redirect } from 'next/navigation';
import { createSupabaseActionClient } from '@/server/auth/server';

/**
 * Server Action: send a magic-link email to the supplied address.
 * Redirects to /login/sent on success or /login?error=... on failure.
 *
 * Configured in Supabase Studio:
 *   Authentication > Providers > Email > "Enable email confirmations" off
 *   (magic link only; no email/password). SMTP via Resend.
 *
 * Site URL must be set to the production URL so the magic link points to the
 * right host. NEXT_PUBLIC_SITE_URL is used here for the redirectTo parameter.
 */
export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    const msg = encodeURIComponent('Please enter a valid email address.');
    redirect(`/login?error=${msg}`);
  }

  const supabase = createSupabaseActionClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      // Do not auto-create user accounts. Only existing partners can sign in.
      shouldCreateUser: false,
    },
  });

  if (error) {
    // Common: "Email not allowed" when shouldCreateUser is false and the
    // email doesn't match a known user. Don't leak which - generic message.
    const msg = encodeURIComponent(
      'We could not send a sign-in link. Check your email address or contact platform admin.'
    );
    redirect(`/login?error=${msg}`);
  }

  redirect(`/login/sent?email=${encodeURIComponent(email)}`);
}

/**
 * Server Action: sign out the current user and redirect to /login.
 *
 * Fail-soft when Supabase env not set (M0 cloud provisioning pending):
 * just bounce to /login without a real session call.
 */
export async function signOut() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createSupabaseActionClient();
    await supabase.auth.signOut();
  }
  redirect('/login');
}
