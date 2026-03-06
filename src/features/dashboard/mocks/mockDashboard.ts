import type { DashboardSnapshot } from '../types';

export const mockDashboardSnapshot: DashboardSnapshot = {
  cards: {
    gatewayStatus: 'online',
    uptimeLabel: '5d 14h 27m',
    requestsToday: 982,
    requestsTrend: {
      direction: 'up',
      percentage: 12.4,
    },
    tokenUsageToday: 2_184_304,
    estimatedCostToday: 13.72,
  },
  requestVolume24h: [
    { x: '00:00', y: 26, timestamp: Date.now() - 24 * 60 * 60 * 1000 },
    { x: '03:00', y: 19, timestamp: Date.now() - 21 * 60 * 60 * 1000 },
    { x: '06:00', y: 35, timestamp: Date.now() - 18 * 60 * 60 * 1000 },
    { x: '09:00', y: 52, timestamp: Date.now() - 15 * 60 * 60 * 1000 },
    { x: '12:00', y: 74, timestamp: Date.now() - 12 * 60 * 60 * 1000 },
    { x: '15:00', y: 81, timestamp: Date.now() - 9 * 60 * 60 * 1000 },
    { x: '18:00', y: 68, timestamp: Date.now() - 6 * 60 * 60 * 1000 },
    { x: '21:00', y: 59, timestamp: Date.now() - 3 * 60 * 60 * 1000 },
    { x: '23:59', y: 42, timestamp: Date.now() },
  ],
  tokenUsageByModel: [
    { model: 'gpt-5.3-codex', tokens: 2_184_304, color: '#264653' },
  ],
  latency: [
    { percentile: 'p50', value: 420 },
    { percentile: 'p95', value: 1040 },
    { percentile: 'p99', value: 1910 },
  ],
  channels: [],
  sessions: [],
  usageProviders: [],
  fetchedAt: Date.now(),
};
