import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from '@/lib/save-queue';

type Draft = { notes: string; rating: number };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe('inspection saves', () => {
  it('coalesces typing and only reports saved after the server acknowledges it', async () => {
    vi.useFakeTimers();
    const request = deferred();
    const write = vi.fn(() => request.promise);
    const queue = createSaveQueue<Draft>(write);
    queue.add({ notes: 'D' }); queue.add({ notes: 'Damp', rating: 2 });
    expect(queue.getStatus()).toBe('pending');
    await vi.advanceTimersByTimeAsync(800);
    expect(write).toHaveBeenCalledExactlyOnceWith({ notes: 'Damp', rating: 2 });
    expect(queue.hasUnsaved()).toBe(true);
    request.resolve();
    expect(await queue.flush()).toBe(true);
    expect(queue.getStatus()).toBe('saved');
  });

  it('retains failed edits and lets the user retry without retyping', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = createSaveQueue<Draft>(write);
    queue.add({ notes: 'Inspect roof', rating: 3 });
    expect(await queue.flush()).toBe(false);
    expect(queue.getStatus()).toBe('error');
    expect(queue.hasUnsaved()).toBe(true);
    expect(await queue.flush()).toBe(true);
    expect(write.mock.calls[1][0]).toEqual({ notes: 'Inspect roof', rating: 3 });
    expect(queue.hasUnsaved()).toBe(false);
  });

  it('serializes requests and waits for newer edits before allowing navigation', async () => {
    const first = deferred(); const second = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const queue = createSaveQueue<Draft>(write);
    queue.add({ notes: 'First' });
    const saving = queue.flush();
    queue.add({ notes: 'Latest' });
    const navigation = queue.flush();
    expect(navigation).toBe(saving);
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve(); await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toEqual({ notes: 'Latest' });
    expect(queue.getStatus()).toBe('saving');
    second.resolve();
    expect(await navigation).toBe(true);
    expect(queue.getStatus()).toBe('saved');
  });

  it('keeps the latest edit when an older request fails in flight', async () => {
    const request = deferred();
    const write = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    const queue = createSaveQueue<Draft>(write);
    queue.add({ notes: 'Old', rating: 4 });
    const saving = queue.flush();
    queue.add({ notes: 'New' });
    request.reject(new Error('connection lost'));
    expect(await saving).toBe(false);
    expect(await queue.flush()).toBe(true);
    expect(write.mock.calls[1][0]).toEqual({ notes: 'New', rating: 4 });
  });

  it('does not retry indefinitely or claim success after a failed save', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValue(new Error('offline'));
    const queue = createSaveQueue<Draft>(write);
    queue.add({ notes: 'Keep this evidence' });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(60000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.getStatus()).toBe('error');
  });
});
