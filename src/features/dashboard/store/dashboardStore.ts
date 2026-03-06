import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import {
  getChannels,
  getCostHistory,
  getHealth,
  getLatencyStats,
  getModels,
  getRequestStats,
  getSessionsSummary,
  getTokenStats,
  getUsageSummary,
} from '../../../lib/api';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import { usePricingStore, estimateCostFromTokens } from '../../settings/store/pricingStore';
import type { CostHistorySource, DailyCostSummary, DashboardRefreshInterval, DashboardSnapshot } from '../types';

interface DashboardStoreState {
  snapshot: DashboardSnapshot;
  costHistory: Record<string, DailyCostSummary>;
  costHistorySource: CostHistorySource;
  isLoading: boolean;
  isRefreshing: boolean;
  hasLoadedOnce: boolean;
  lastError: string | null;
  refreshInterval: DashboardRefreshInterval;
  isHydrated: boolean;
  refresh: () => Promise<void>;
  setRefreshInterval: (value: DashboardRefreshInterval) => void;
}

const MAX_REQUEST_POINTS = 720;
const MAX_COST_HISTORY_DAYS = 120;
const ONE_HOUR_MS = 60 * 60 * 1000;

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function downsampleSeries<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints || maxPoints <= 0) {
    return items;
  }

  const step = Math.ceil(items.length / maxPoints);
  const sampled: T[] = [];

  for (let index = 0; index < items.length; index += step) {
    sampled.push(items[index]);
  }

  const lastItem = items[items.length - 1];
  if (sampled.length >= maxPoints) {
    sampled[maxPoints - 1] = lastItem;
    return sampled.slice(0, maxPoints);
  }

  if (sampled[sampled.length - 1] !== lastItem) {
    sampled.push(lastItem);
  }

  return sampled;
}

function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function withUpdatedCostHistory(
  history: Record<string, DailyCostSummary>,
  input: { tokens: number; cost: number; requests: number; now: number },
): Record<string, DailyCostSummary> {
  const key = toLocalDateKey(input.now);
  const next: Record<string, DailyCostSummary> = {
    ...history,
    [key]: {
      date: key,
      tokens: Math.max(0, Math.floor(input.tokens)),
      cost: Math.max(0, Number(input.cost.toFixed(4))),
      requests: Math.max(0, Math.floor(input.requests)),
      updatedAt: input.now,
    },
  };

  const sortedKeys = Object.keys(next).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (sortedKeys.length <= MAX_COST_HISTORY_DAYS) {
    return next;
  }

  for (const oldKey of sortedKeys.slice(MAX_COST_HISTORY_DAYS)) {
    delete next[oldKey];
  }
  return next;
}

function toCostHistoryRecord(items: DailyCostSummary[]): Record<string, DailyCostSummary> {
  const next: Record<string, DailyCostSummary> = {};
  for (const item of items) {
    next[item.date] = item;
  }
  return next;
}

function toSnapshot(args: {
  uptimeSeconds: number;
  requestsToday: number;
  requests24h: Array<{ timestamp: string | number; count: number }>;
  requestsTrend: { direction: 'up' | 'down' | 'flat'; percentage: number };
  tokensByModel: Array<{ model: string; tokens: number }>;
  totalTokens: number;
  latency: { p50: number; p95: number; p99: number };
  channels: Array<{
    id: string;
    name?: string;
    status?: 'healthy' | 'degraded' | 'offline' | 'unknown';
    sessionCount?: number;
    lastEventAt?: string;
    description?: string;
  }>;
  sessions: Array<{
    id: string;
    title?: string;
    agentId?: string;
    channelId?: string;
    model?: string;
    updatedAt?: string;
    messageCount?: number;
    contextTokens?: number;
    contextCount?: number;
  }>;
  usageProviders: Array<{
    id: string;
    name?: string;
    plan?: string;
    period?: string;
    remainingPercent?: number;
    resetAt?: string;
    used?: number;
    limit?: number;
  }>;
}): DashboardSnapshot {
  const pricing = usePricingStore.getState().pricing;
  const sampledRequests24h = downsampleSeries(args.requests24h, MAX_REQUEST_POINTS);
  const now = Date.now();
  const normalizedRequests24h = sampledRequests24h
    .map((item, index, source) => {
      const numericTimestamp = typeof item.timestamp === 'number' ? item.timestamp : Number(item.timestamp);
      const parsedFromNumber = Number.isFinite(numericTimestamp)
        ? numericTimestamp > 1_000_000_000_000
          ? numericTimestamp
          : numericTimestamp * 1000
        : Number.NaN;
      const parsedFromString =
        typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : Number.NaN;
      const parsed = Number.isFinite(parsedFromNumber) ? parsedFromNumber : parsedFromString;
      const fallbackTimestamp = now - (source.length - 1 - index) * ONE_HOUR_MS;
      const timestamp = Number.isNaN(parsed) ? fallbackTimestamp : parsed;
      return {
        timestamp,
        count: item.count,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    cards: {
      gatewayStatus: 'online',
      uptimeLabel: formatUptime(args.uptimeSeconds),
      requestsToday: args.requestsToday,
      requestsTrend: args.requestsTrend,
      tokenUsageToday: args.totalTokens,
      estimatedCostToday: estimateCostFromTokens(args.tokensByModel, pricing),
    },
    requestVolume24h: normalizedRequests24h.map((item) => ({
      x: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      y: item.count,
      timestamp: item.timestamp,
    })),
    tokenUsageByModel: args.tokensByModel.map((item, index) => ({
      model: item.model,
      tokens: item.tokens,
      color: DASHBOARD_COLORS[index % DASHBOARD_COLORS.length],
    })),
    latency: [
      { percentile: 'p50', value: args.latency.p50 },
      { percentile: 'p95', value: args.latency.p95 },
      { percentile: 'p99', value: args.latency.p99 },
    ],
    channels: args.channels.map((item) => ({
      id: item.id,
      name: item.name ?? item.id,
      status: item.status ?? 'unknown',
      sessionCount: item.sessionCount ?? 0,
      lastEventAt: item.lastEventAt,
      description: item.description,
    })),
    sessions: args.sessions.map((item) => ({
      id: item.id,
      title: item.title ?? item.id,
      agentId: item.agentId,
      channelId: item.channelId,
      model: item.model,
      updatedAt: item.updatedAt,
      messageCount: item.messageCount ?? 0,
      contextCount: item.contextCount ?? item.contextTokens ?? 0,
    })),
    usageProviders: args.usageProviders.map((item) => ({
      id: item.id,
      name: item.name ?? item.id,
      plan: item.plan,
      period: item.period,
      remainingPercent: item.remainingPercent,
      resetAt: item.resetAt,
      used: item.used,
      limit: item.limit,
    })),
    fetchedAt: Date.now(),
  };
}

const DASHBOARD_COLORS = ['#264653', '#FFCAD4', '#2A9D8F', '#533326', '#CAFFF5', '#B23A48'];
let inflightRefreshId = 0;

function createEmptyDashboardSnapshot(): DashboardSnapshot {
  const now = Date.now();
  const points = Array.from({ length: 24 }, (_, index) => {
    const timestamp = now - (23 - index) * 60 * 60 * 1000;
    return {
      x: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      y: 0,
      timestamp,
    };
  });

  return {
    cards: {
      gatewayStatus: 'offline',
      uptimeLabel: '0m',
      requestsToday: 0,
      requestsTrend: { direction: 'flat', percentage: 0 },
      tokenUsageToday: 0,
      estimatedCostToday: 0,
    },
    requestVolume24h: points,
    tokenUsageByModel: [],
    latency: [
      { percentile: 'p50', value: 0 },
      { percentile: 'p95', value: 0 },
      { percentile: 'p99', value: 0 },
    ],
    channels: [],
    sessions: [],
    usageProviders: [],
    fetchedAt: now,
  };
}

export const useDashboardStore = create<DashboardStoreState>()(
  persist(
    (set) => ({
      snapshot: createEmptyDashboardSnapshot(),
      costHistory: {},
      costHistorySource: 'local',
      isLoading: false,
      isRefreshing: false,
      hasLoadedOnce: false,
      lastError: null,
      refreshInterval: 60,
      isHydrated: false,

      refresh: async () => {
        const refreshId = ++inflightRefreshId;
        set((state) => ({
          isLoading: !state.hasLoadedOnce,
          isRefreshing: true,
          lastError: null,
        }));

        try {
          const [health, todayRequests, volume24h, volume7d, tokenStats, latency, channelsResult, sessionsResult, usageResult, modelsResult, costHistoryResult] =
            await Promise.allSettled([
            getHealth(),
            getRequestStats('today'),
            getRequestStats('24h'),
            getRequestStats('7d'),
            getTokenStats('today'),
            getLatencyStats('24h'),
            getChannels(),
            getSessionsSummary(),
            getUsageSummary(),
            getModels(),
            getCostHistory(MAX_COST_HISTORY_DAYS),
          ]);

          if (health.status !== 'fulfilled') {
            throw new Error('Core dashboard stats are unavailable.');
          }

          if (refreshId !== inflightRefreshId) {
            return;
          }

          const fallbackRequestPoints = Array.from({ length: 24 }, (_, index) => ({
            timestamp: new Date(Date.now() - (23 - index) * 60 * 60 * 1000).toISOString(),
            count: 0,
          }));

          const todayRequestsValue =
            todayRequests.status === 'fulfilled'
              ? todayRequests.value
              : {
                  period: 'today',
                  total: 0,
                  trend: { direction: 'flat' as const, percentage: 0 },
                  points: fallbackRequestPoints,
                };

          const volume24hValue =
            volume24h.status === 'fulfilled'
              ? volume24h.value
              : {
                  period: '24h',
                  total: 0,
                  trend: { direction: 'flat' as const, percentage: 0 },
                  points: fallbackRequestPoints,
                };
          const volume7dValue =
            volume7d.status === 'fulfilled'
              ? volume7d.value
              : {
                  period: '7d',
                  total: volume24hValue.total,
                  trend: volume24hValue.trend,
                  points: volume24hValue.points,
                };
          const requestSeriesValue =
            volume7dValue.points.length > volume24hValue.points.length ? volume7dValue : volume24hValue;

          const tokenStatsValue =
            tokenStats.status === 'fulfilled'
              ? tokenStats.value
              : {
                  total: 0,
                  byModel: [] as Array<{ model: string; tokens: number }>,
                };

          const knownModelIds =
            modelsResult.status === 'fulfilled'
              ? new Set(modelsResult.value.models.map((item) => item.id.toLowerCase()))
              : null;
          const normalizedByModel = tokenStatsValue.byModel.filter(
            (item) => item.model.trim().length > 0 && Number.isFinite(item.tokens),
          );
          const filteredByModel =
            knownModelIds && knownModelIds.size > 0
              ? normalizedByModel.filter((item) => knownModelIds.has(item.model.toLowerCase()))
              : normalizedByModel;
          const finalByModel = filteredByModel.length > 0 ? filteredByModel : normalizedByModel;
          const totalTokensFromModels = finalByModel.reduce((sum, item) => sum + item.tokens, 0);

          const latencyValue =
            latency.status === 'fulfilled'
              ? latency.value
              : {
                  p50: 0,
                  p95: 0,
                  p99: 0,
                };

          const now = Date.now();
          const snapshot = toSnapshot({
            uptimeSeconds: health.value.uptimeSeconds,
            requestsToday: todayRequestsValue.total,
            requests24h: requestSeriesValue.points,
            requestsTrend: todayRequestsValue.trend,
            tokensByModel: finalByModel,
            totalTokens: totalTokensFromModels > 0 ? totalTokensFromModels : tokenStatsValue.total,
            latency: latencyValue,
            channels: channelsResult.status === 'fulfilled' ? channelsResult.value.channels : [],
            sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value.sessions : [],
            usageProviders: usageResult.status === 'fulfilled' ? usageResult.value.providers : [],
          });
          const gatewayCostHistory =
            costHistoryResult.status === 'fulfilled' && Array.isArray(costHistoryResult.value) && costHistoryResult.value.length > 0
              ? toCostHistoryRecord(
                  costHistoryResult.value.map((item) => ({
                    date: item.date,
                    tokens: Math.max(0, Math.floor(item.tokens)),
                    cost: Math.max(0, Number(item.cost)),
                    requests: Math.max(0, Math.floor(item.requests)),
                    updatedAt: now,
                  })),
                )
              : null;

          set((state) => ({
            snapshot,
            costHistory: withUpdatedCostHistory(gatewayCostHistory ?? state.costHistory, {
              tokens: snapshot.cards.tokenUsageToday,
              cost: snapshot.cards.estimatedCostToday,
              requests: snapshot.cards.requestsToday,
              now,
            }),
            costHistorySource: gatewayCostHistory ? 'gateway' : 'local',
            isLoading: false,
            isRefreshing: false,
            hasLoadedOnce: true,
            lastError: null,
          }));
        } catch (error: unknown) {
          if (refreshId !== inflightRefreshId) {
            return;
          }

          set({
            isLoading: false,
            isRefreshing: false,
            hasLoadedOnce: true,
            lastError: error instanceof Error ? error.message : 'Failed to refresh dashboard',
          });
        }
      },

      setRefreshInterval: (value) => {
        set({ refreshInterval: value });
      },
    }),
    {
      name: STORAGE_KEYS.DASHBOARD_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        snapshot: state.snapshot,
        costHistory: state.costHistory,
        costHistorySource: state.costHistorySource,
        refreshInterval: state.refreshInterval,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const sanitizedHistory: Record<string, DailyCostSummary> = {};
          for (const [key, item] of Object.entries(state.costHistory ?? {})) {
            if (!item || typeof item !== 'object') {
              continue;
            }
            sanitizedHistory[key] = {
              date: item.date || key,
              tokens: Number.isFinite(item.tokens) ? Math.max(0, Math.floor(item.tokens)) : 0,
              cost: Number.isFinite(item.cost) ? Math.max(0, Number(item.cost)) : 0,
              requests: Number.isFinite(item.requests) ? Math.max(0, Math.floor(item.requests)) : 0,
              updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
            };
          }

          useDashboardStore.setState({
            costHistory: withUpdatedCostHistory(sanitizedHistory, {
              tokens: state.snapshot.cards.tokenUsageToday,
              cost: state.snapshot.cards.estimatedCostToday,
              requests: state.snapshot.cards.requestsToday,
              now: state.snapshot.fetchedAt || Date.now(),
            }),
            costHistorySource: state.costHistorySource === 'gateway' ? 'gateway' : 'local',
          });
        }

        useDashboardStore.setState({ isHydrated: true });
      },
    },
  ),
);
