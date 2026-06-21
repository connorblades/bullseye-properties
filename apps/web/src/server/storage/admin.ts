import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-side storage writes (M3-T10).
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY - bypasses RLS and storage policies, so this
 * module must never be imported by client code (guarded by `server-only`).
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export const DEAL_PACKS_BUCKET = 'deal-packs';

/** Upload (or overwrite) a deal-pack PDF. Returns the storage path + byte size. */
export async function uploadDealPack(storagePath: string, pdf: Buffer): Promise<{ path: string; size: number }> {
  const { error } = await supabaseAdmin()
    .storage.from(DEAL_PACKS_BUCKET)
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Deal-pack upload failed: ${error.message}`);
  return { path: storagePath, size: pdf.length };
}

/** Short-lived signed download URL for a stored deal pack. */
export async function signDealPackUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(DEAL_PACKS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw new Error(`Could not sign deal-pack URL: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}
