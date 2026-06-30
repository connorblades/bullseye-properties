import 'server-only';
import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '@/server/db/client';
import { shareTokens, shareTokenEvents } from '@/server/db/schema';
import type { ShareToken } from '@/server/db/schema';

/**
 * Share-token store (M4-T1).
 *
 * Revocable, expiring, per-link tokens that gate the public delivery surfaces:
 *   - kind 'outline' -> Report 1 (Outline pack at /o/[token])
 *   - kind 'report'  -> Report 2 (full Standard Deal Report at /r/[token])
 *
 * The raw secret lives only in the URL and is returned by createShareToken
 * once; the DB stores only its SHA-256 hash, so a table leak does not expose
 * working links. Resolution hashes the inbound secret and looks it up by
 * token_hash (owner connection, no session - mirrors loadDealPublic), then
 * checks revoked_at / expires_at. Partner management (create / revoke / list)
 * is tenant-scoped at the app layer by the caller (requireTenant), matching the
 * rest of the codebase.
 *
 * Pure helpers (generate / hash / status) are exported for unit testing without
 * a database.
 */

export type ShareTokenKind = 'outline' | 'report';
export type ShareEvent = 'open' | 'download';
export type ShareTokenStatus = 'active' | 'revoked' | 'expired';

/** Default link lifetime when the caller does not pin an explicit expiry. */
export const DEFAULT_SHARE_TTL_DAYS = 90;

// ── Pure helpers (unit-testable, no DB) ─────────────────────────────────────

/** A fresh, unguessable share secret: 32 random bytes, base64url (~43 chars). */
export function generateShareSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hash (hex) of a share secret - what we store and look up by. */
export function hashShareToken(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Privacy-preserving hash of a client IP for access logging. Salted with
 * SHARE_LINK_SALT so the stored value is not reversible to a raw IP. Returns
 * null for a missing IP.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.SHARE_LINK_SALT ?? '';
  return crypto.createHash('sha256').update(`${salt}:${ip}`, 'utf8').digest('hex');
}

/** now + DEFAULT_SHARE_TTL_DAYS, used when no explicit expiry is given. */
export function defaultShareExpiry(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Live status of a token row: revoked beats expired beats active. */
export function shareTokenStatus(
  row: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): ShareTokenStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

// ── DB operations (tenant-scoped by the caller) ─────────────────────────────

export interface CreateShareTokenInput {
  tenantId: string;
  dealId: string;
  kind: ShareTokenKind;
  createdBy?: string | null;
  reportVersionId?: string | null;
  label?: string | null;
  recipientEmail?: string | null;
  /** Explicit expiry; omit for the 90-day default, or pass null for no expiry. */
  expiresAt?: Date | null;
}

/**
 * Mint a new share token. Returns the created row plus the raw secret, which is
 * shown to the partner once and never stored in plaintext.
 */
export async function createShareToken(
  input: CreateShareTokenInput,
): Promise<{ token: ShareToken; secret: string }> {
  const secret = generateShareSecret();
  const now = new Date();
  const expiresAt =
    input.expiresAt === undefined ? defaultShareExpiry(now) : input.expiresAt;

  const [token] = await db
    .insert(shareTokens)
    .values({
      id: `sht-${ulid()}`,
      tenantId: input.tenantId,
      dealId: input.dealId,
      kind: input.kind,
      tokenHash: hashShareToken(secret),
      reportVersionId: input.reportVersionId ?? null,
      label: input.label ?? null,
      recipientEmail: input.recipientEmail ?? null,
      expiresAt,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  return { token, secret };
}

export type ResolveResult =
  | { ok: true; token: ShareToken }
  | { ok: false; reason: 'not_found' | 'revoked' | 'expired' };

/**
 * Resolve a raw share secret to its token row, enforcing kind, revocation, and
 * expiry. Read-only: callers log the access separately via recordShareAccess so
 * a HEAD/prefetch or a render failure does not inflate the open count.
 */
export async function resolveShareToken(
  secret: string,
  opts?: { kind?: ShareTokenKind },
): Promise<ResolveResult> {
  if (!secret) return { ok: false, reason: 'not_found' };

  const rows = await db
    .select()
    .from(shareTokens)
    .where(eq(shareTokens.tokenHash, hashShareToken(secret)))
    .limit(1);

  const token = rows[0];
  if (!token) return { ok: false, reason: 'not_found' };
  if (opts?.kind && token.kind !== opts.kind) return { ok: false, reason: 'not_found' };

  const status = shareTokenStatus(token, new Date());
  if (status === 'revoked') return { ok: false, reason: 'revoked' };
  if (status === 'expired') return { ok: false, reason: 'expired' };

  return { ok: true, token };
}

/**
 * Record an access against a token: insert an event row and bump the rolling
 * counters on the token. Best-effort - logging never blocks delivery, so the
 * caller may ignore a thrown error.
 */
export async function recordShareAccess(
  token: Pick<ShareToken, 'id' | 'tenantId'>,
  event: ShareEvent,
  meta?: { ipHash?: string | null; userAgent?: string | null },
): Promise<void> {
  const now = new Date();
  await db.insert(shareTokenEvents).values({
    id: `ste-${ulid()}`,
    tokenId: token.id,
    tenantId: token.tenantId,
    event,
    ipHash: meta?.ipHash ?? null,
    userAgent: meta?.userAgent ?? null,
    occurredAt: now,
  });
  await db
    .update(shareTokens)
    .set({ lastAccessedAt: now, accessCount: sql`${shareTokens.accessCount} + 1` })
    .where(eq(shareTokens.id, token.id));
}

/**
 * Revoke a token. Tenant-scoped so a partner can only revoke their own links.
 * Idempotent: re-revoking keeps the original revoked_at. Returns true if a row
 * was newly revoked.
 */
export async function revokeShareToken(tokenId: string, tenantId: string): Promise<boolean> {
  const updated = await db
    .update(shareTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(shareTokens.id, tokenId),
        eq(shareTokens.tenantId, tenantId),
        sql`${shareTokens.revokedAt} is null`,
      ),
    )
    .returning({ id: shareTokens.id });
  return updated.length > 0;
}

/** All share tokens for a deal, newest first. Tenant-scoped. */
export async function listShareTokensForDeal(
  tenantId: string,
  dealId: string,
): Promise<ShareToken[]> {
  return db
    .select()
    .from(shareTokens)
    .where(and(eq(shareTokens.tenantId, tenantId), eq(shareTokens.dealId, dealId)))
    .orderBy(desc(shareTokens.createdAt));
}
