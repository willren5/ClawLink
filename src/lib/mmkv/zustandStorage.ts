import type { StateStorage } from 'zustand/middleware';

import { appStorage } from './storage';

export const mmkvZustandStorage: StateStorage = {
  getItem: (name) => appStorage.getString(name) ?? null,
  setItem: (name, value) => {
    appStorage.set(name, value);
  },
  removeItem: (name) => {
    appStorage.remove(name);
  },
};
