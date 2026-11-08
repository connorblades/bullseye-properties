export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Serial writes; a failed patch stays available for retry in this page. */
export function createSaveQueue<T extends object>(write: (patch: Partial<T>) => Promise<unknown>, delay = 800) {
  let pending: Partial<T> = {};
  let running: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: SaveStatus = 'saved';
  const listeners = new Set<() => void>();
  const notify = (next: SaveStatus) => { status = next; listeners.forEach((listener) => listener()); };
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };

  const flush = (): Promise<boolean> => {
    cancelTimer();
    if (running) return running;
    if (Object.keys(pending).length === 0) return Promise.resolve(true);
    running = (async () => {
      while (Object.keys(pending).length > 0) {
        const patch = pending;
        pending = {};
        notify('saving');
        try {
          await write(patch);
        } catch {
          // Edits made while the request was in flight take precedence.
          pending = { ...patch, ...pending };
          cancelTimer();
          notify('error');
          return false;
        }
      }
      notify('saved');
      return true;
    })().finally(() => { running = null; });
    return running;
  };

  return {
    flush,
    add(patch: Partial<T>) {
      if (Object.keys(patch).length === 0) return;
      pending = { ...pending, ...patch };
      notify(running ? 'saving' : 'pending');
      cancelTimer();
      timer = setTimeout(() => { void flush(); }, delay);
    },
    getStatus: () => status,
    hasUnsaved: () => status !== 'saved',
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
