/** Serialize actions which read the saved deal, and stop them if saving fails. */
export function createSavedAction(flush: () => Promise<boolean>) {
  let busy = false;
  const listeners = new Set<() => void>();
  const setBusy = (value: boolean) => {
    busy = value;
    listeners.forEach((listener) => listener());
  };
  return {
    getBusy: () => busy,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async run(action: () => void | Promise<void>, prepare?: () => void): Promise<boolean> {
      // A synchronous lock also covers double clicks before React rerenders.
      if (busy) return false;
      setBusy(true);
      try {
        prepare?.();
        if (!await flush()) return false;
        await action();
        return true;
      } finally {
        setBusy(false);
      }
    },
  };
}
