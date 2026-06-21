import 'server-only';

/**
 * Claude configuration - model IDs, pricing, ceilings, kill switch.
 *
 * Server-only. The Anthropic API key never reaches the client bundle (the
 * `server-only` import throws at build time if this module is pulled into a
 * Client Component).
 *
 * Model IDs come from env (ANTHROPIC_MODEL_PRIMARY / ANTHROPIC_MODEL_FALLBACK).
 * BUILD V1 specced `claude-sonnet-4-7`, which does not exist; the current
 * defaults below were confirmed via the claude-api reference:
 *   - primary  : claude-sonnet-4-6  ($3 / $15 per MTok, 1M context, 64K out)
 *   - fallback : claude-haiku-4-5   ($1 / $5  per MTok, 200K context, 64K out)
 */

const DEFAULT_PRIMARY = 'claude-sonnet-4-6';
const DEFAULT_FALLBACK = 'claude-haiku-4-5';

export const CLAUDE_MODELS = {
  primary: process.env.ANTHROPIC_MODEL_PRIMARY?.trim() || DEFAULT_PRIMARY,
  fallback: process.env.ANTHROPIC_MODEL_FALLBACK?.trim() || DEFAULT_FALLBACK,
} as const;

// USD per million tokens, keyed by model id. Unknown models fall back to
// Sonnet-tier pricing so the cost ledger never under-counts.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

export function priceFor(modelId: string): { input: number; output: number } {
  return PRICING[modelId] ?? DEFAULT_PRICING;
}

/** Estimated USD cost for a single generation. */
export function estimateUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(modelId);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/**
 * Pre-flight token ceilings (enforced in M3-T4). A request whose estimated
 * input exceeds maxInput, or whose requested max_tokens exceeds maxOutput,
 * is rejected before it ever reaches the API.
 */
export const TOKEN_CEILINGS = {
  maxInput: 50_000,
  maxOutput: 10_000,
} as const;

/** Per-tenant per-day cost ceiling in USD (enforced in M3-T4 via ai_cost_ledger). */
export const DAILY_TENANT_USD_CEILING = Number(process.env.CLAUDE_DAILY_USD_CEILING ?? '5');

/** Kill switch: CLAUDE_DISABLE=true blocks all Claude routes (M3-T4). */
export function claudeDisabled(): boolean {
  return process.env.CLAUDE_DISABLE === 'true';
}

export function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight token guards (M3-T4) - pure, no DB. The daily per-tenant budget
// guard lives in cost.ts (it needs the ai_cost_ledger).
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a request would breach a token ceiling. */
export class TokenCeilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCeilingError';
  }
}

/**
 * Rough pre-flight token estimate. English runs ~4 chars/token; we divide by
 * 3.5 to bias high so the ceiling errs toward caution. Used only to reject
 * obviously oversized prompts before they reach the API - exact usage comes
 * back from the API response and is what we bill against.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Reject a request that would exceed the input or output ceiling. Returns the
 * estimated input-token count on success.
 */
export function assertWithinTokenCeilings(opts: {
  system: string;
  userPrompt: string;
  maxOutput: number;
}): number {
  const inputTokens = estimateTokens(opts.system) + estimateTokens(opts.userPrompt);
  if (inputTokens > TOKEN_CEILINGS.maxInput) {
    throw new TokenCeilingError(
      `Prompt too large: ~${inputTokens.toLocaleString()} input tokens exceeds the ${TOKEN_CEILINGS.maxInput.toLocaleString()} limit.`
    );
  }
  if (opts.maxOutput > TOKEN_CEILINGS.maxOutput) {
    throw new TokenCeilingError(
      `Requested output of ${opts.maxOutput.toLocaleString()} tokens exceeds the ${TOKEN_CEILINGS.maxOutput.toLocaleString()} limit.`
    );
  }
  return inputTokens;
}
