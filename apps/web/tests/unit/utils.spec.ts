import { describe, expect, it } from 'vitest';
import { cn, fmtMoney } from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('dedupes tailwind classes via twMerge', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('ignores falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('fmtMoney', () => {
  it('formats integer pounds with no decimals and the GBP symbol', () => {
    expect(fmtMoney(112500)).toBe('£112,500');
  });

  it('handles zero', () => {
    expect(fmtMoney(0)).toBe('£0');
  });

  it('rounds away decimals', () => {
    expect(fmtMoney(112500.99)).toBe('£112,501');
  });
});
