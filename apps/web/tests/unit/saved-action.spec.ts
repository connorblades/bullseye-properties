import { describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from '@/lib/save-queue';
import { createSavedAction } from '@/lib/saved-action';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('actions that depend on saved deal data', () => {
  it('waits for every queued edit before opening the outline or generating a report', async () => {
    const first = deferred(); const second = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const queue = createSaveQueue<{ notes: string }>(write);
    const saved = createSavedAction(queue.flush);
    const action = vi.fn();
    queue.add({ notes: 'First observation' });
    const running = saved.run(action);
    queue.add({ notes: 'Latest observation' });
    expect(action).not.toHaveBeenCalled();
    first.resolve(); await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    expect(saved.getBusy()).toBe(true);
    second.resolve();
    expect(await running).toBe(true);
    expect(write.mock.calls[1][0]).toEqual({ notes: 'Latest observation' });
    expect(action).toHaveBeenCalledOnce();
    expect(saved.getBusy()).toBe(false);
  });

  it('does not run the action after a failed save; retry keeps the latest edit', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = createSaveQueue<{ notes: string }>(write);
    const saved = createSavedAction(queue.flush);
    const action = vi.fn();
    queue.add({ notes: 'Retain this evidence' });
    expect(await saved.run(action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(queue.getStatus()).toBe('error');
    expect(saved.getBusy()).toBe(false);
    expect(await saved.run(action)).toBe(true);
    expect(write.mock.calls[1][0]).toEqual({ notes: 'Retain this evidence' });
    expect(action).toHaveBeenCalledOnce();
  });

  it('prevents duplicate navigation, progress writes and report jobs while busy', async () => {
    const job = deferred();
    const saved = createSavedAction(async () => true);
    const action = vi.fn(() => job.promise);
    const prepare = vi.fn();
    const running = saved.run(action, prepare);
    expect(await saved.run(action, prepare)).toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
    job.resolve();
    expect(await running).toBe(true);
  });

  it('saves navigation progress before changing the page', async () => {
    const queue = createSaveQueue<{ progress: number }>(vi.fn().mockResolvedValue(undefined));
    const saved = createSavedAction(queue.flush);
    const navigate = vi.fn(() => { expect(queue.getStatus()).toBe('saved'); });
    expect(await saved.run(navigate, () => queue.add({ progress: 9 }))).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('releases the action lock after generation or publishing fails', async () => {
    const saved = createSavedAction(async () => true);
    const listener = vi.fn();
    const unsubscribe = saved.subscribe(listener);
    await expect(saved.run(async () => { throw new Error('report unavailable'); })).rejects.toThrow('report unavailable');
    expect(saved.getBusy()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(await saved.run(vi.fn())).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
