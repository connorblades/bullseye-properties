import type { ShareTokenKind } from '@/server/share/tokens';

/**
 * Build the public share URL for a kind + secret against a base origin.
 * Pure (no server deps) so it's usable from Server Actions and unit tests.
 * Outline links live at /o/[secret], full-report links at /r/[secret].
 */
export function buildShareUrl(kind: ShareTokenKind, secret: string, baseUrl: string): string {
  const path = kind === 'report' ? 'r' : 'o';
  return `${baseUrl.replace(/\/+$/, '')}/${path}/${secret}`;
}
