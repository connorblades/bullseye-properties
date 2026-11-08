/** Shared by the login page, actions and middleware; never expose key values. */
export const AUTH_UNAVAILABLE = 'Sign-in is unavailable because bpOS is not connected to its account service. The connection needs to be restored before you can sign in.';

export function authConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
