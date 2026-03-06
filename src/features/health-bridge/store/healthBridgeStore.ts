import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import type { HealthBridgeMetricKey, HealthBridgePermissionStatus, HealthBridgeSummary } from '../types';

interface HealthBridgeStoreState {
  enabled: boolean;
  permissionStatus: HealthBridgePermissionStatus;
  lastPermissionRequestedAt: number | null;
  lastSummary: HealthBridgeSummary | null;
  lastSummaryFetchedAt: number | null;
  metrics: Record<HealthBridgeMetricKey, boolean>;
  setEnabled: (enabled: boolean) => void;
  toggleMetric: (key: HealthBridgeMetricKey) => void;
  setPermissionStatus: (status: HealthBridgePermissionStatus) => void;
  markPermissionRequested: () => void;
  setSummary: (summary: HealthBridgeSummary | null) => void;
  reset: () => void;
}

const DEFAULT_METRICS: Record<HealthBridgeMetricKey, boolean> = {
  steps: true,
  activeEnergyKcal: true,
  exerciseMinutes: true,
  standHours: true,
  sleepDuration: false,
};

export const useHealthBridgeStore = create<HealthBridgeStoreState>()(
  persist(
    (set) => ({
      enabled: false,
      permissionStatus: 'idle',
      lastPermissionRequestedAt: null,
      lastSummary: null,
      lastSummaryFetchedAt: null,
      metrics: { ...DEFAULT_METRICS },
      setEnabled: (enabled) => set({ enabled }),
      toggleMetric: (key) =>
        set((state) => ({
          metrics: {
            ...state.metrics,
            [key]: !state.metrics[key],
          },
        })),
      setPermissionStatus: (permissionStatus) => set({ permissionStatus }),
      markPermissionRequested: () => set({ lastPermissionRequestedAt: Date.now() }),
      setSummary: (summary) =>
        set({
          lastSummary: summary,
          lastSummaryFetchedAt: summary ? Date.now() : null,
        }),
      reset: () =>
        set({
          enabled: false,
          permissionStatus: 'idle',
          lastPermissionRequestedAt: null,
          lastSummary: null,
          lastSummaryFetchedAt: null,
          metrics: { ...DEFAULT_METRICS },
        }),
    }),
    {
      name: STORAGE_KEYS.HEALTH_BRIDGE_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        permissionStatus: state.permissionStatus,
        lastPermissionRequestedAt: state.lastPermissionRequestedAt,
        lastSummary: state.lastSummary,
        lastSummaryFetchedAt: state.lastSummaryFetchedAt,
        metrics: state.metrics,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        useHealthBridgeStore.setState({
          enabled: state.enabled === true,
          permissionStatus:
            state.permissionStatus === 'authorized' ||
            state.permissionStatus === 'denied' ||
            state.permissionStatus === 'unavailable'
              ? state.permissionStatus
              : 'idle',
          lastPermissionRequestedAt:
            typeof state.lastPermissionRequestedAt === 'number' && Number.isFinite(state.lastPermissionRequestedAt)
              ? state.lastPermissionRequestedAt
              : null,
          lastSummary:
            state.lastSummary && typeof state.lastSummary.generatedAt === 'string' ? state.lastSummary : null,
          lastSummaryFetchedAt:
            typeof state.lastSummaryFetchedAt === 'number' && Number.isFinite(state.lastSummaryFetchedAt)
              ? state.lastSummaryFetchedAt
              : null,
          metrics: {
            ...DEFAULT_METRICS,
            ...(state.metrics ?? {}),
          },
        });
      },
    },
  ),
);
