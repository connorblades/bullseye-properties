import 'server-only';
import { resolveShareToken } from './tokens';
import type { ShareToken } from '@/server/db/schema';
import { loadDealPublic } from '@/server/deal/public';
import type { Deal } from '@/lib/deal-store';
import type { PartnerIdentity } from '@/server/pdf/components';

/**
 * Public delivery-surface access resolution (M4-T2).
 *
 * Turns a `/o/[segment]` path segment into either a loaded deal or a clear
 * reason it can't be shown. The segment is tried as a share-token secret first
 * (kind 'outline'); a revoked or expired token short-circuits to that status so
 * the page can say so instead of 404'ing. An unrecognised segment falls back to
 * the legacy raw-ULID lookup (loadDealPublic) so links sent before tokenisation
 * keep working. The matched token (if any) is returned so the route can log the
 * access with the request's IP + user agent.
 */
export type OutlineAccess =
  | { status: 'ok'; deal: Deal; partner: PartnerIdentity; reference: string; token: ShareToken | null }
  | { status: 'revoked' }
  | { status: 'expired' }
  | { status: 'not_found' };

export async function resolveOutlineAccess(segment: string): Promise<OutlineAccess> {
  // Token resolution is wrapped so that a token-store outage (e.g. migration
  // 0008 not yet applied in this environment) degrades to the legacy raw-ULID
  // path rather than 500'ing a public delivery page.
  let res: Awaited<ReturnType<typeof resolveShareToken>> | null = null;
  try {
    res = await resolveShareToken(segment, { kind: 'outline' });
  } catch {
    res = null;
  }

  if (res?.ok) {
    const loaded = await loadDealPublic(res.token.dealId);
    if (!loaded) return { status: 'not_found' };
    return { status: 'ok', ...loaded, token: res.token };
  }
  if (res && !res.ok && res.reason === 'revoked') return { status: 'revoked' };
  if (res && !res.ok && res.reason === 'expired') return { status: 'expired' };

  // Unrecognised as a token (or token store unavailable): fall back to the
  // legacy raw-ULID outline link.
  const legacy = await loadDealPublic(segment);
  if (legacy) return { status: 'ok', ...legacy, token: null };
  return { status: 'not_found' };
}
