import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';
import { buildIncidentConditionKey, defaultDeepLinkForAlert, quickActionIdsForAlert } from '../incidentDefinitions';
import type { AlertQuickActionId, AlertSeverity, AlertStatus, AlertType } from '../types';

const MAX_ALERT_HISTORY = 200;

interface AlertStoreInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  dedupeKey?: string;
  deepLink?: string;
  quickActions?: AlertQuickActionId[];
}

export interface AlertHistoryItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt: number;
  eventCount: number;
  status: AlertStatus;
  dedupeKey: string;
  conditionKey: string;
  deepLink: string;
  quickActions: AlertQuickActionId[];
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  snoozedUntil: number | null;
  read: boolean;
}

interface AlertStoreState {
  alerts: AlertHistoryItem[];
  snoozedConditions: Record<string, number>;
  addAlert: (alert: AlertStoreInput) => AlertHistoryItem | null;
  markRead: (id: string) => void;
  markAllRead: () => void;
  acknowledgeAlert: (id: string) => void;
  resolveAlert: (id: string) => void;
  snoozeAlert: (id: string, durationMs: number) => number | null;
  isAlertSnoozed: (type: AlertType, dedupeKey?: string | null, at?: number) => boolean;
  clearAlerts: () => void;
}

function randomAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(value: string): string {
  return value.trim();
}

function sanitizeStatus(value: AlertStatus | string | undefined): AlertStatus {
  if (value === 'acknowledged' || value === 'resolved') {
    return value;
  }
  return 'active';
}

function sanitizeQuickActions(
  input: AlertQuickActionId[] | string[] | undefined,
  fallbackType: AlertType,
): AlertQuickActionId[] {
  const allowed = new Set<AlertQuickActionId>([
    'reconnect_gateway',
    'open_monitor',
    'flush_queue',
    'open_chat',
    'refresh_agents',
    'open_agents',
    'open_dashboard',
  ]);
  const normalized: AlertQuickActionId[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string' && allowed.has(item as AlertQuickActionId)) {
        normalized.push(item as AlertQuickActionId);
      }
    }
  }
  return normalized.length > 0 ? normalized : quickActionIdsForAlert(fallbackType);
}

function pruneExpiredSnoozes(snoozedConditions: Record<string, number>, now = Date.now()): Record<string, number> {
  return Object.fromEntries(
    Object.entries(snoozedConditions).filter(([, value]) => Number.isFinite(value) && value > now),
  );
}

function sortAlertsWithLimit(alerts: AlertHistoryItem[]): AlertHistoryItem[] {
  return [...alerts]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_ALERT_HISTORY);
}

export const useAlertStore = create<AlertStoreState>()(
  persist(
    (set, get) => ({
      alerts: [],
      snoozedConditions: {},
      addAlert: (alert) => {
        const now = Date.now();
        const dedupeKey = alert.dedupeKey?.trim() || alert.type;
        const conditionKey = buildIncidentConditionKey(alert.type, dedupeKey);
        const snoozedConditions = pruneExpiredSnoozes(get().snoozedConditions, now);

        if ((snoozedConditions[conditionKey] ?? 0) > now) {
          if (Object.keys(snoozedConditions).length !== Object.keys(get().snoozedConditions).length) {
            set({ snoozedConditions });
          }
          return null;
        }

        const existing = get().alerts.find((item) => item.conditionKey === conditionKey && item.status !== 'resolved');
        if (existing) {
          const nextEntry: AlertHistoryItem = {
            ...existing,
            severity: alert.severity,
            title: sanitizeText(alert.title),
            body: sanitizeText(alert.body),
            updatedAt: now,
            lastTriggeredAt: now,
            eventCount: existing.eventCount + 1,
            status: 'active',
            acknowledgedAt: null,
            read: false,
            snoozedUntil: (snoozedConditions[conditionKey] ?? 0) > now ? snoozedConditions[conditionKey] : null,
            deepLink: alert.deepLink?.trim() || existing.deepLink || defaultDeepLinkForAlert(alert.type),
            quickActions: sanitizeQuickActions(alert.quickActions, alert.type),
          };

          set((state) => ({
            alerts: sortAlertsWithLimit([
              ...state.alerts.filter((item) => item.id !== existing.id),
              nextEntry,
            ]),
            snoozedConditions,
          }));

          return nextEntry;
        }

        const entry: AlertHistoryItem = {
          id: randomAlertId(),
          type: alert.type,
          severity: alert.severity,
          title: sanitizeText(alert.title),
          body: sanitizeText(alert.body),
          createdAt: now,
          updatedAt: now,
          lastTriggeredAt: now,
          eventCount: 1,
          status: 'active',
          dedupeKey,
          conditionKey,
          deepLink: alert.deepLink?.trim() || defaultDeepLinkForAlert(alert.type),
          quickActions: sanitizeQuickActions(alert.quickActions, alert.type),
          acknowledgedAt: null,
          resolvedAt: null,
          snoozedUntil: null,
          read: false,
        };

        set((state) => ({
          alerts: appendWithLimit(state.alerts, entry, MAX_ALERT_HISTORY),
          snoozedConditions,
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
      acknowledgeAlert: (id) => {
        const targetId = id.trim();
        if (!targetId) {
          return;
        }

        set((state) => ({
          alerts: state.alerts.map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  status: item.status === 'resolved' ? item.status : 'acknowledged',
                  acknowledgedAt: Date.now(),
                  read: true,
                }
              : item,
          ),
        }));
      },
      resolveAlert: (id) => {
        const targetId = id.trim();
        if (!targetId) {
          return;
        }

        set((state) => ({
          alerts: state.alerts.map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  status: 'resolved',
                  resolvedAt: Date.now(),
                  read: true,
                }
              : item,
          ),
        }));
      },
      snoozeAlert: (id, durationMs) => {
        const targetId = id.trim();
        if (!targetId || !Number.isFinite(durationMs) || durationMs <= 0) {
          return null;
        }

        const target = get().alerts.find((item) => item.id === targetId);
        if (!target) {
          return null;
        }

        const until = Date.now() + durationMs;
        set((state) => ({
          alerts: state.alerts.map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  status: item.status === 'resolved' ? item.status : 'acknowledged',
                  acknowledgedAt: item.status === 'resolved' ? item.acknowledgedAt : Date.now(),
                  snoozedUntil: until,
                  read: true,
                }
              : item,
          ),
          snoozedConditions: {
            ...pruneExpiredSnoozes(state.snoozedConditions),
            [target.conditionKey]: until,
          },
        }));
        return until;
      },
      isAlertSnoozed: (type, dedupeKey, at = Date.now()) => {
        const conditionKey = buildIncidentConditionKey(type, dedupeKey);
        const snoozedConditions = pruneExpiredSnoozes(get().snoozedConditions, at);
        const isSnoozed = (snoozedConditions[conditionKey] ?? 0) > at;
        if (Object.keys(snoozedConditions).length !== Object.keys(get().snoozedConditions).length) {
          set({ snoozedConditions });
        }
        return isSnoozed;
      },
      clearAlerts: () => {
        set({ alerts: [], snoozedConditions: {} });
      },
    }),
    {
      name: STORAGE_KEYS.ALERT_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        alerts: state.alerts,
        snoozedConditions: state.snoozedConditions,
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
            updatedAt:
              typeof (item as Partial<AlertHistoryItem>).updatedAt === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).updatedAt)
                ? (item as Partial<AlertHistoryItem>).updatedAt as number
                : Number.isFinite(item.createdAt)
                  ? item.createdAt
                  : Date.now(),
            lastTriggeredAt:
              typeof (item as Partial<AlertHistoryItem>).lastTriggeredAt === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).lastTriggeredAt)
                ? (item as Partial<AlertHistoryItem>).lastTriggeredAt as number
                : Number.isFinite(item.createdAt)
                  ? item.createdAt
                  : Date.now(),
            eventCount:
              typeof (item as Partial<AlertHistoryItem>).eventCount === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).eventCount)
                ? Math.max(1, Math.floor((item as Partial<AlertHistoryItem>).eventCount as number))
                : 1,
            status: sanitizeStatus((item as Partial<AlertHistoryItem>).status),
            dedupeKey:
              typeof (item as Partial<AlertHistoryItem>).dedupeKey === 'string' &&
              (item as Partial<AlertHistoryItem>).dedupeKey?.trim()
                ? (item as Partial<AlertHistoryItem>).dedupeKey?.trim() as string
                : item.type,
            conditionKey:
              typeof (item as Partial<AlertHistoryItem>).conditionKey === 'string' &&
              (item as Partial<AlertHistoryItem>).conditionKey?.trim()
                ? (item as Partial<AlertHistoryItem>).conditionKey?.trim() as string
                : buildIncidentConditionKey(
                    item.type,
                    typeof (item as Partial<AlertHistoryItem>).dedupeKey === 'string'
                      ? (item as Partial<AlertHistoryItem>).dedupeKey
                      : item.type,
                  ),
            deepLink:
              typeof (item as Partial<AlertHistoryItem>).deepLink === 'string' &&
              (item as Partial<AlertHistoryItem>).deepLink?.trim()
                ? (item as Partial<AlertHistoryItem>).deepLink?.trim() as string
                : defaultDeepLinkForAlert(item.type),
            quickActions: sanitizeQuickActions((item as Partial<AlertHistoryItem>).quickActions, item.type),
            acknowledgedAt:
              typeof (item as Partial<AlertHistoryItem>).acknowledgedAt === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).acknowledgedAt)
                ? (item as Partial<AlertHistoryItem>).acknowledgedAt as number
                : null,
            resolvedAt:
              typeof (item as Partial<AlertHistoryItem>).resolvedAt === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).resolvedAt)
                ? (item as Partial<AlertHistoryItem>).resolvedAt as number
                : null,
            snoozedUntil:
              typeof (item as Partial<AlertHistoryItem>).snoozedUntil === 'number' &&
              Number.isFinite((item as Partial<AlertHistoryItem>).snoozedUntil)
                ? (item as Partial<AlertHistoryItem>).snoozedUntil as number
                : null,
            read: item.read === true,
          }));
        const snoozedConditions = pruneExpiredSnoozes(
          (state as { snoozedConditions?: Record<string, number> }).snoozedConditions ?? {},
        );

        useAlertStore.setState({
          alerts: hydrated.sort((left, right) => right.updatedAt - left.updatedAt),
          snoozedConditions,
        });
      },
    },
  ),
);
