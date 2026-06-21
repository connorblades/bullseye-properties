import { FONTS } from './fonts';

/**
 * Brand tokens for the PDF (BSE-DESIGN-V1 §4 palette, §5 type). Re-exported as
 * plain constants so React-PDF style objects can reference them. FONTS is
 * resolved at render time (after registerFonts), so read it inside components.
 */

export const C = {
  navy: '#1f5199',
  navyDark: '#0d2a5e',
  navyDeeper: '#0a1e47',
  navyLight: '#2461b3',
  success: '#10b981',
  successDark: '#047857',
  successLight: '#d1fae5',
  amber: '#f59e0b',
  amberLight: '#fef3c7',
  red: '#ef4444',
  redLight: '#fee2e2',
  ink: '#1a2332',
  inkMid: '#495057',
  inkMuted: '#6c757d',
  bg: '#f7f8fa',
  white: '#ffffff',
  border: '#e3e6ea',
} as const;

export { FONTS };

/** Verbatim AI-disclosure footer (AC-07) - must appear on every page. */
export const DISCLOSURE_FOOTER =
  'This report includes narrative sections drafted with AI assistance and reviewed by your accredited partner. ' +
  "Comparable evidence and financial calculations are sourced from the partner's own data inputs.";

export function fmtGBP(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );
}

export function fmtPct(n: number, dp = 1): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(dp)}%`;
}
