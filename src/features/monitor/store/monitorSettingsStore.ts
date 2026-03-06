import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

const STORE_KEY = 'monitor-settings';

interface MonitorSettingsState {
  probePort: number;
  setProbePort: (port: number) => void;
}

export const useMonitorSettingsStore = create<MonitorSettingsState>()(
  persist(
    (set) => ({
      probePort: 9100,
      setProbePort: (port) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return;
        }

        set({ probePort: port });
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({ probePort: state.probePort }),
    },
  ),
);
