import type { PersistStorage } from 'zustand/middleware';

import { appStorage } from './storage';

type PersistedStorageValue<T> = {
  state: T;
  version?: number;
};

export function createDebouncedJsonStorage<T>(delayMs = 250): PersistStorage<T> {
  const pendingValues = new Map<string, PersistedStorageValue<T>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = (name: string): void => {
    const timer = timers.get(name);
    if (timer) {
      clearTimeout(timer);
      timers.delete(name);
    }

    const pending = pendingValues.get(name);
    if (!pending) {
      return;
    }

    pendingValues.delete(name);
    appStorage.set(name, JSON.stringify(pending));
  };

  return {
    getItem: (name) => {
      flush(name);
      const raw = appStorage.getString(name);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as PersistedStorageValue<T>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pendingValues.set(name, value);

      const existingTimer = timers.get(name);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      timers.set(
        name,
        setTimeout(() => {
          flush(name);
        }, delayMs),
      );
    },
    removeItem: (name) => {
      const existingTimer = timers.get(name);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.delete(name);
      }

      pendingValues.delete(name);
      appStorage.remove(name);
    },
  };
}
