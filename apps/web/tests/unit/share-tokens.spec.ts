import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_TTL_DAYS,
  defaultShareExpiry,
  generateShareSecret,
  hashIp,
  hashShareToken,
  shareTokenStatus,
} from '@/server/share/tokens';

describe('generateShareSecret', () => {
  it('returns a url-safe string with no padding', () => {
    const s = generateShareSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s).not.toContain('=');
  });

  it('is 256 bits of entropy (43 base64url chars)', () => {
    expect(generateShareSecret()).toHaveLength(43);
  });

  it('is unique across calls', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateShareSecret()));
    expect(seen.size).toBe(200);
  });
});

describe('hashShareToken', () => {
  it('is deterministic for the same secret', () => {
    expect(hashShareToken('abc')).toBe(hashShareToken('abc'));
  });

  it('differs for different secrets', () => {
    expect(hashShareToken('abc')).not.toBe(hashShareToken('abd'));
  });

  it('is a 64-char hex sha256 digest', () => {
    expect(hashShareToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not echo the secret', () => {
    expect(hashShareToken('the-secret')).not.toContain('the-secret');
  });
});

describe('hashIp', () => {
  it('returns null for a missing ip', () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp(undefined)).toBeNull();
    expect(hashIp('')).toBeNull();
  });

  it('is deterministic and non-reversible (does not contain the raw ip)', () => {
    const h = hashIp('203.0.113.7');
    expect(h).toBe(hashIp('203.0.113.7'));
    expect(h).not.toContain('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different ips', () => {
    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
  });
});

describe('defaultShareExpiry', () => {
  it('is the default TTL ahead of now', () => {
    const now = new Date('2026-06-30T00:00:00.000Z');
    const exp = defaultShareExpiry(now);
    const days = (exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(DEFAULT_SHARE_TTL_DAYS);
  });
});

describe('shareTokenStatus', () => {
  const now = new Date('2026-06-30T12:00:00.000Z');

  it('is active when not revoked and not yet expired', () => {
    expect(shareTokenStatus({ revokedAt: null, expiresAt: new Date('2026-09-01T00:00:00Z') }, now)).toBe('active');
  });

  it('is active when there is no expiry', () => {
    expect(shareTokenStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active');
  });

  it('is expired when the expiry has passed', () => {
    expect(shareTokenStatus({ revokedAt: null, expiresAt: new Date('2026-06-01T00:00:00Z') }, now)).toBe('expired');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(shareTokenStatus({ revokedAt: null, expiresAt: now }, now)).toBe('expired');
  });

  it('revoked beats expired', () => {
    expect(
      shareTokenStatus({ revokedAt: new Date('2026-06-15T00:00:00Z'), expiresAt: new Date('2026-06-01T00:00:00Z') }, now),
    ).toBe('revoked');
  });
});
