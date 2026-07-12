import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/middleware';

/**
 * Regression guard for the machine-ingress middleware bypass.
 *
 * The token-guarded `/api/leads/ingest` route (AC-13) has no auth session, so it
 * MUST skip the session gate or the middleware 307s the POST to /login and the
 * external scraper can never reach it. Session-gated routes must stay gated.
 */
describe('isPublicPath', () => {
  it('lets the bearer-token machine ingress through the session gate', () => {
    expect(isPublicPath('/api/leads/ingest')).toBe(true);
  });

  it('keeps the login, auth and public surfaces open', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/api/public/anything')).toBe(true);
  });

  it('keeps app + other API routes gated', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/review')).toBe(false);
    expect(isPublicPath('/deal/123/wizard/7')).toBe(false);
    expect(isPublicPath('/api/deal/123/report-stream')).toBe(false);
  });
});
