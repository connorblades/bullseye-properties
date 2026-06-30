import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, __resetRateLimits } from '@/server/security/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => __resetRateLimits());

  it('allows up to the limit within a window, then blocks', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, now).ok).toBe(true);
    }
    const blocked = rateLimit('k', 3, 1000, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it('reports decreasing remaining allowance', () => {
    const now = 5_000;
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(2);
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(1);
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(0);
  });

  it('resets after the window elapses', () => {
    const now = 10_000;
    rateLimit('k', 1, 1000, now);
    expect(rateLimit('k', 1, 1000, now).ok).toBe(false);
    expect(rateLimit('k', 1, 1000, now + 1000).ok).toBe(true); // window rolled over
  });

  it('tracks keys independently', () => {
    const now = 0;
    expect(rateLimit('a', 1, 1000, now).ok).toBe(true);
    expect(rateLimit('a', 1, 1000, now).ok).toBe(false);
    expect(rateLimit('b', 1, 1000, now).ok).toBe(true); // different key unaffected
  });
});
