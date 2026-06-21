import { describe, expect, it, vi } from 'vitest';

// Mock the DB-backed cost module so the retry/fallback logic runs without
// Postgres. Budget check + cost writeback become no-ops.
vi.mock('@/server/claude/cost', () => ({
  assertUnderDailyBudget: vi.fn(async () => {}),
  recordCost: vi.fn(async () => {}),
  spentTodayUsd: vi.fn(async () => 0),
  BudgetExceededError: class extends Error {},
}));

import { generateGuarded } from '@/server/claude/generate';
import { generateSectionResilient, MANUAL_DRAFT_PLACEHOLDER } from '@/server/claude/prompts';
import type { StreamMessageParams, StreamMessageResult } from '@/server/claude/client';

const noSleep = async () => {};

function overloaded(): Error {
  const e = new Error('Overloaded') as Error & { status: number };
  e.status = 529;
  return e;
}

describe('generateGuarded retry + Haiku fallback (M3-T3)', () => {
  it('retries on 529 twice then succeeds on the 2nd retry using the fallback model', async () => {
    const models: string[] = [];
    let n = 0;
    const streamer = async (params: StreamMessageParams): Promise<StreamMessageResult> => {
      models.push(params.model);
      n += 1;
      if (n <= 2) throw overloaded(); // 529 twice
      params.onTextDelta?.('ok'); // success on attempt index 2
      return { text: 'ok', modelUsed: params.model, inputTokens: 10, outputTokens: 5, stopReason: 'end_turn' };
    };
    const onFallback = vi.fn();

    const result = await generateGuarded({
      tenantId: 't',
      system: 's',
      userPrompt: 'p',
      model: 'sonnet-primary',
      fallbackModel: 'haiku-fallback',
      maxTokens: 100,
      streamer,
      sleep: noSleep,
      onFallback,
    });

    // Two retries happened, and the 2nd retry switched to the fallback model.
    expect(models).toEqual(['sonnet-primary', 'sonnet-primary', 'haiku-fallback']);
    expect(result.modelUsed).toBe('haiku-fallback');

    // Banner state was set exactly once when the fallback engaged.
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ model: 'haiku-fallback', attempt: 2 });
  });

  it('does NOT retry on a non-retryable error (e.g. 400)', async () => {
    let calls = 0;
    const streamer = async (): Promise<StreamMessageResult> => {
      calls += 1;
      const e = new Error('Bad request') as Error & { status: number };
      e.status = 400;
      throw e;
    };
    await expect(
      generateGuarded({ tenantId: 't', system: 's', userPrompt: 'p', streamer, sleep: noSleep })
    ).rejects.toThrow('Bad request');
    expect(calls).toBe(1);
  });
});

describe('manual-draft fallback on total outage (M3-T3)', () => {
  it('returns a manual-draft section instead of throwing, never blocking the PDF', async () => {
    const onError = vi.fn();
    // Inject a generator that runs the real retry loop against an always-529
    // streamer, so retries exhaust and it throws - exercising the true outage.
    const out = await generateSectionResilient({
      section: 'why-this-fits',
      context: 'Address: 12 Browning Street',
      tenantId: 't',
      onError,
      generate: (opts) =>
        generateGuarded({ ...opts, streamer: async () => { throw overloaded(); }, sleep: noSleep }),
    });

    expect(out.manualDraft).toBe(true);
    expect(out.narrative).toBe(MANUAL_DRAFT_PLACEHOLDER);
    expect(out.modelUsed).toBe('manual');
    expect(out.promptVersionHash).toMatch(/^[0-9a-f]{16}$/);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
