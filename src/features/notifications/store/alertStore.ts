import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';

const MAX_ALERT_HISTORY = 200;

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType = 'agent_error' | 'disconnect_timeout' | 'queue_backlog' | 'error_count_transition';

export interface AlertHistoryItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

interface AlertStoreState {
  alerts: AlertHistoryItem[];
  addAlert: (alert: Omit<AlertHistoryItem, 'id' | 'createdAt' | 'read'>) => AlertHistoryItem;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAlerts: () => void;
}

function randomAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(value: string): string {
  return value.trim();
}

export const useAlertStore = create<AlertStoreState>()(
  persist(
    (set, get) => ({
      alerts: [],
      addAlert: (alert) => {
        const entry: AlertHistoryItem = {
          id: randomAlertId(),
          type: alert.type,
          severity: alert.severity,
          title: sanitizeText(alert.title),
          body: sanitizeText(alert.body),
          createdAt: Date.now(),
          read: false,
        };

        set((state) => ({
          alerts: appendWithLimit(state.alerts, entry, MAX_ALERT_HISTORY),
        }));

        return entry;
      },
      markRead: (id) => {
        const targetId = id.trim();
        if (!targetId) {
          return;
        }

        set((state) => ({
          alerts: state.alerts.map((item) => (item.id === targetId ? { ...item, read: true } : item)),
        }));
      },
      markAllRead: () => {
        const alerts = get().alerts;
        if (alerts.length === 0) {
          return;
        }
        set({
          alerts: alerts.map((item) => (item.read ? item : { ...item, read: true })),
        });
      },
      clearAlerts: () => {
        set({ alerts: [] });
      },
    }),
    {
      name: STORAGE_KEYS.ALERT_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        alerts: state.alerts,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const hydrated = state.alerts
          .filter((item) => item && typeof item.id === 'string')
          .slice(-MAX_ALERT_HISTORY)
          .map((item) => ({
            id: item.id.trim() || randomAlertId(),
            type: item.type,
            severity: item.severity,
            title: sanitizeText(item.title),
            body: sanitizeText(item.body),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
            read: item.read === true,
          }));

        useAlertStore.setState({ alerts: hydrated });
      },
    },
  ),
);
