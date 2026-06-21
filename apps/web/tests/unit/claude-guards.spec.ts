import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  priceFor,
  estimateUsd,
  estimateTokens,
  assertWithinTokenCeilings,
  TokenCeilingError,
  TOKEN_CEILINGS,
  claudeDisabled,
} from '@/server/claude/config';

describe('priceFor', () => {
  it('returns known model pricing', () => {
    expect(priceFor('claude-sonnet-4-6')).toEqual({ input: 3, output: 15 });
    expect(priceFor('claude-haiku-4-5')).toEqual({ input: 1, output: 5 });
  });

  it('falls back to Sonnet-tier pricing for unknown models (never under-counts)', () => {
    expect(priceFor('some-future-model')).toEqual({ input: 3, output: 15 });
  });
});

describe('estimateUsd', () => {
  it('computes per-MTok cost from input + output', () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(estimateUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18, 5);
  });

  it('is zero for zero tokens', () => {
    expect(estimateUsd('claude-haiku-4-5', 0, 0)).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('biases high (>= chars/4)', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(100);
  });
});

describe('assertWithinTokenCeilings (M3-T4 pre-flight)', () => {
  it('passes a normal request and returns the estimated input tokens', () => {
    const n = assertWithinTokenCeilings({ system: 'short system', userPrompt: 'short prompt', maxOutput: 1500 });
    expect(n).toBeGreaterThan(0);
  });

  it('rejects an over-sized input', () => {
    const huge = 'x'.repeat((TOKEN_CEILINGS.maxInput + 5_000) * 4);
    expect(() => assertWithinTokenCeilings({ system: '', userPrompt: huge, maxOutput: 1500 })).toThrow(TokenCeilingError);
  });

  it('rejects an over-sized requested output', () => {
    expect(() =>
      assertWithinTokenCeilings({ system: 's', userPrompt: 'p', maxOutput: TOKEN_CEILINGS.maxOutput + 1 })
    ).toThrow(TokenCeilingError);
  });
});

describe('claudeDisabled (kill switch)', () => {
  const original = process.env.CLAUDE_DISABLE;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_DISABLE;
    else process.env.CLAUDE_DISABLE = original;
  });

  it('is true only when set to the exact string "true"', () => {
    process.env.CLAUDE_DISABLE = 'true';
    expect(claudeDisabled()).toBe(true);
    process.env.CLAUDE_DISABLE = 'false';
    expect(claudeDisabled()).toBe(false);
    delete process.env.CLAUDE_DISABLE;
    expect(claudeDisabled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Client-bundle key absence (M3-T4): no `'use client'` module may import the
// server-only Claude internals or reference the API key. The `import
// 'server-only'` guards in those modules make Next fail the build if this is
// ever violated; this test catches it earlier, at unit-test time.
// ─────────────────────────────────────────────────────────────────────────────
describe('client-bundle does not reach Claude server internals', () => {
  const srcRoot = path.resolve(__dirname, '../../src');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const clientFiles = walk(srcRoot).filter((f) => {
    const head = readFileSync(f, 'utf8').slice(0, 64);
    return /^['"]use client['"]/.test(head.trimStart());
  });

  it('finds at least one client component to check', () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it('no client component imports @/server/claude/* or references the API key', () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const src = readFileSync(f, 'utf8');
      if (/@\/server\/claude\//.test(src) || /ANTHROPIC_API_KEY/.test(src)) {
        offenders.push(path.relative(srcRoot, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
