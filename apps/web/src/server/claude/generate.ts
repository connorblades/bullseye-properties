import 'server-only';
import { CLAUDE_MODELS, claudeDisabled, assertWithinTokenCeilings } from './config';
import { assertUnderDailyBudget, recordCost } from './cost';
import { streamMessage, type StreamMessageParams, type StreamMessageResult } from './client';

/**
 * The single guarded entry point for every Claude generation (M3-T4 + M3-T3).
 *
 * Enforces, in order:
 *   1. Kill switch  (CLAUDE_DISABLE)
 *   2. Token ceilings (pre-flight, pure)
 *   3. Per-tenant daily budget (ai_cost_ledger)
 * then streams the completion with retry + Haiku fallback, and records the
 * actual cost. On total outage it throws so the caller can drop to a
 * manual-draft path that never blocks the PDF compile.
 *
 * Retry policy (M3-T3): retry on 429 (rate limit) and 529 (overloaded) with
 * exponential backoff + jitter, max 3 retries. The 2nd retry switches the
 * primary model (Sonnet) to the fallback (Haiku) and fires onFallback so the
 * UI can raise a degradation banner.
 */

/** Thrown when the kill switch is on. */
export class ClaudeDisabledError extends Error {
  constructor() {
    super('AI generation is currently disabled (CLAUDE_DISABLE).');
    this.name = 'ClaudeDisabledError';
  }
}

export type GuardedGenerateOptions = {
  tenantId: string;
  system: string;
  userPrompt: string;
  model?: string;
  fallbackModel?: string;
  maxTokens?: number;
  maxRetries?: number;
  /** Full accumulated text so far - safe to replace the UI buffer on each call. */
  onText?: (fullText: string) => void;
  /** Fired once when generation switches to the fallback model. */
  onFallback?: (info: { model: string; attempt: number }) => void;
  /** Injectable seams for tests. */
  streamer?: (params: StreamMessageParams) => Promise<StreamMessageResult>;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 3;
/** Retry only on rate-limit (429) and overloaded (529). */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || status === 529;
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt; // 500, 1000, 2000, ...
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function generateGuarded(opts: GuardedGenerateOptions): Promise<StreamMessageResult> {
  if (claudeDisabled()) throw new ClaudeDisabledError();

  const primary = opts.model ?? CLAUDE_MODELS.primary;
  const fallback = opts.fallbackModel ?? CLAUDE_MODELS.fallback;
  const maxTokens = opts.maxTokens ?? 1500;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const streamer = opts.streamer ?? streamMessage;
  const sleep = opts.sleep ?? realSleep;

  assertWithinTokenCeilings({ system: opts.system, userPrompt: opts.userPrompt, maxOutput: maxTokens });
  await assertUnderDailyBudget(opts.tenantId);

  let fallbackAnnounced = false;
  let lastErr: unknown;

  // attempt 0 = initial; attempts 1..maxRetries = retries. From attempt 2 on we
  // use the fallback (Haiku) model.
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const model = attempt >= 2 ? fallback : primary;
    if (model === fallback && !fallbackAnnounced) {
      fallbackAnnounced = true;
      opts.onFallback?.({ model, attempt });
    }

    let acc = '';
    try {
      const result = await streamer({
        model,
        system: opts.system,
        userPrompt: opts.userPrompt,
        maxTokens,
        onTextDelta: (delta) => {
          acc += delta;
          opts.onText?.(acc);
        },
      });

      await recordCost({
        tenantId: opts.tenantId,
        modelId: result.modelUsed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetryable(err)) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }

  // Unreachable in practice; the loop either returns or throws.
  throw lastErr ?? new Error('Generation failed');
}
