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
const HEALTH_BRIDGE_SUMMARY_TTL_MS = 15 * 60 * 1000;

function isFreshSummary(
  summary: HealthBridgeSummary | null | undefined,
  fetchedAt: number | null | undefined,
  now = Date.now(),
): boolean {
  if (!summary) {
    return false;
  }

  const generatedAt = Date.parse(summary.generatedAt);
  const timestamp =
    typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0
      ? fetchedAt
      : Number.isFinite(generatedAt)
        ? generatedAt
        : Number.NaN;

  return Number.isFinite(timestamp) ? now - timestamp <= HEALTH_BRIDGE_SUMMARY_TTL_MS : false;
}

function sanitizeSummary(
  summary: HealthBridgeSummary | null | undefined,
  fetchedAt: number | null | undefined,
): { summary: HealthBridgeSummary | null; fetchedAt: number | null } {
  const normalizedFetchedAt =
    typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) ? fetchedAt : null;

  if (
    !summary ||
    typeof summary.generatedAt !== 'string' ||
    typeof summary.date !== 'string' ||
    typeof summary.timezone !== 'string' ||
    !summary.activity ||
    !isFreshSummary(summary, normalizedFetchedAt)
  ) {
    return {
      summary: null,
      fetchedAt: null,
    };
  }

  return {
    summary,
    fetchedAt: normalizedFetchedAt ?? (Date.parse(summary.generatedAt) || null),
  };
}

export const useHealthBridgeStore = create<HealthBridgeStoreState>()(
  persist(
    (set) => ({
      enabled: false,
      permissionStatus: 'idle',
      lastPermissionRequestedAt: null,
      lastSummary: null,
      lastSummaryFetchedAt: null,
      metrics: { ...DEFAULT_METRICS },
      setEnabled: (enabled) =>
        set((state) =>
          enabled
            ? { enabled: true }
            : {
                ...state,
                enabled: false,
                lastSummary: null,
                lastSummaryFetchedAt: null,
              },
        ),
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
        set(() => {
          const sanitized = sanitizeSummary(summary, summary ? Date.now() : null);
          return {
            lastSummary: sanitized.summary,
            lastSummaryFetchedAt: sanitized.fetchedAt,
          };
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

        const sanitized = sanitizeSummary(state.lastSummary, state.lastSummaryFetchedAt);

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
          lastSummary: sanitized.summary,
          lastSummaryFetchedAt: sanitized.fetchedAt,
          metrics: {
            ...DEFAULT_METRICS,
            ...(state.metrics ?? {}),
          },
        });
      },
    },
  ),
);
