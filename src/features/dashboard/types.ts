export interface TrendData {
  direction: 'up' | 'down' | 'flat';
  percentage: number;
}

export interface StatusCardData {
  gatewayStatus: 'online' | 'offline';
  uptimeLabel: string;
  requestsToday: number;
  requestsTrend: TrendData;
  tokenUsageToday: number;
  estimatedCostToday: number;
}

export interface LinePoint {
  x: string;
  y: number;
  timestamp: number;
}

export interface ModelTokenSlice {
  model: string;
  tokens: number;
  color: string;
}

export interface LatencyPoint {
  percentile: 'p50' | 'p95' | 'p99';
  value: number;
}

export interface DashboardSnapshot {
  cards: StatusCardData;
  requestVolume24h: LinePoint[];
  tokenUsageByModel: ModelTokenSlice[];
  latency: LatencyPoint[];
  channels: Array<{
    id: string;
    name: string;
    status: 'healthy' | 'degraded' | 'offline' | 'unknown';
    sessionCount: number;
    lastEventAt?: string;
    description?: string;
  }>;
  sessions: Array<{
    id: string;
    title: string;
    agentId?: string;
    channelId?: string;
    model?: string;
    updatedAt?: string;
    messageCount: number;
    contextCount: number;
  }>;
  usageProviders: Array<{
    id: string;
    name: string;
    plan?: string;
    period?: string;
    remainingPercent?: number;
    resetAt?: string;
    used?: number;
    limit?: number;
  }>;
  fetchedAt: number;
}

export interface DailyCostSummary {
  date: string;
  tokens: number;
  cost: number;
  requests: number;
  updatedAt: number;
}

export type CostHistorySource = 'gateway' | 'local';

export type DashboardRefreshInterval = 0 | 30 | 60 | 300;
