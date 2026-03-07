import { NativeModules, Platform } from 'react-native';

import { useHealthBridgeStore } from '../store/healthBridgeStore';
import type { HealthBridgeMetricKey, HealthBridgePermissionStatus, HealthBridgeSummary } from '../types';

const MOCK_BASELINE = {
  steps: 8123,
  activeEnergyKcal: 412,
  exerciseMinutes: 39,
  standHours: 10,
  sleepDuration: 421,
} as const;

interface HealthBridgeAuthorizationResponse {
  availability?: string;
  status?: string;
  metricStatuses?: Record<string, string>;
}

interface ClawSurfaceBridgeModule {
  getHealthBridgeAuthorizationStatus?: () => Promise<HealthBridgeAuthorizationResponse>;
  requestHealthBridgePermissions?: (payload: string) => Promise<HealthBridgeAuthorizationResponse>;
  getHealthBridgeSummary?: (payload: string) => Promise<HealthBridgeSummary>;
  updateSurfacePreferences?: (payload: string) => Promise<void>;
}

const nativeBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;
export const HEALTH_BRIDGE_SUMMARY_TTL_MS = 15 * 60 * 1000;
const DEFAULT_METRICS: HealthBridgeMetricKey[] = ['steps', 'activeEnergyKcal', 'exerciseMinutes', 'standHours', 'sleepDuration'];

function normalizeMetrics(metrics?: HealthBridgeMetricKey[]): HealthBridgeMetricKey[] {
  const source = metrics === undefined ? DEFAULT_METRICS : metrics;
  return Array.from(new Set(source)).filter((metric): metric is HealthBridgeMetricKey => DEFAULT_METRICS.includes(metric));
}

function parseSummaryTimestamp(summary: HealthBridgeSummary | null | undefined, fetchedAt?: number | null): number | null {
  if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0) {
    return fetchedAt;
  }

  const generatedAt = summary?.generatedAt ? Date.parse(summary.generatedAt) : Number.NaN;
  return Number.isFinite(generatedAt) ? generatedAt : null;
}

export function isHealthBridgeSummaryFresh(
  summary: HealthBridgeSummary | null | undefined,
  fetchedAt?: number | null,
  now = Date.now(),
): boolean {
  if (!summary) {
    return false;
  }

  const timestamp = parseSummaryTimestamp(summary, fetchedAt);
  return typeof timestamp === 'number' ? now - timestamp <= HEALTH_BRIDGE_SUMMARY_TTL_MS : false;
}

export async function syncHealthBridgePolicyToNative(
  enabled: boolean,
  metrics: HealthBridgeMetricKey[],
): Promise<void> {
  if (Platform.OS !== 'ios' || !nativeBridge?.updateSurfacePreferences) {
    return;
  }

  await nativeBridge.updateSurfacePreferences(
    JSON.stringify({
      healthBridgeEnabled: enabled,
      healthBridgeAllowedMetrics: normalizeMetrics(metrics),
    }),
  );
}

function normalizePermissionStatus(
  payload: HealthBridgeAuthorizationResponse | null | undefined,
): HealthBridgePermissionStatus {
  if (payload?.availability === 'unavailable') {
    return 'unavailable';
  }
  if (payload?.status === 'granted') {
    return 'authorized';
  }
  if (payload?.status === 'denied') {
    return 'denied';
  }
  return 'idle';
}

export async function getHealthBridgePermissionStatus(): Promise<HealthBridgePermissionStatus> {
  if (Platform.OS !== 'ios') {
    return 'unavailable';
  }
  if (!nativeBridge?.getHealthBridgeAuthorizationStatus) {
    return 'unavailable';
  }

  const payload = await nativeBridge.getHealthBridgeAuthorizationStatus();
  return normalizePermissionStatus(payload);
}

export async function requestHealthBridgePermissions(
  metrics?: HealthBridgeMetricKey[],
): Promise<HealthBridgePermissionStatus> {
  if (Platform.OS !== 'ios') {
    return 'unavailable';
  }
  if (!nativeBridge?.requestHealthBridgePermissions) {
    return 'unavailable';
  }

  const selectedMetrics = normalizeMetrics(metrics);
  if (selectedMetrics.length === 0) {
    throw new Error('No Health Bridge metrics are enabled.');
  }
  await syncHealthBridgePolicyToNative(true, selectedMetrics);
  const payload = await nativeBridge.requestHealthBridgePermissions(
    JSON.stringify({
      metrics: selectedMetrics,
    }),
  );
  return normalizePermissionStatus(payload);
}

export async function getHealthBridgeSummary(
  metrics?: HealthBridgeMetricKey[],
): Promise<HealthBridgeSummary> {
  if (Platform.OS !== 'ios') {
    throw new Error('Health Bridge summary is only available on iOS.');
  }
  if (!nativeBridge?.getHealthBridgeSummary) {
    throw new Error('Health Bridge summary bridge is unavailable.');
  }

  const state = useHealthBridgeStore.getState();
  const allowedMetrics = normalizeMetrics(
    DEFAULT_METRICS.filter((metric) => state.metrics[metric]),
  );
  const selectedMetrics = normalizeMetrics(metrics ?? allowedMetrics);

  if (!state.enabled) {
    throw new Error('Health Bridge is disabled.');
  }
  if (state.permissionStatus !== 'authorized') {
    throw new Error('Health Bridge permission is not authorized.');
  }
  if (allowedMetrics.length === 0 || selectedMetrics.length === 0) {
    throw new Error('No Health Bridge metrics are enabled.');
  }

  const effectiveMetrics = selectedMetrics.filter((metric) => allowedMetrics.includes(metric));
  if (effectiveMetrics.length === 0) {
    throw new Error('Requested Health Bridge metrics are not permitted.');
  }

  await syncHealthBridgePolicyToNative(state.enabled, allowedMetrics);
  const summary = await nativeBridge.getHealthBridgeSummary(
    JSON.stringify({
      metrics: effectiveMetrics,
    }),
  );
  return filterHealthBridgeSummary(summary, state.metrics);
}

export function buildHealthBridgePreview(
  metrics: Record<HealthBridgeMetricKey, boolean>,
): HealthBridgeSummary {
  const now = new Date();

  return {
    date: now.toISOString().slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    activity: {
      ...(metrics.steps ? { steps: MOCK_BASELINE.steps } : {}),
      ...(metrics.activeEnergyKcal ? { activeEnergyKcal: MOCK_BASELINE.activeEnergyKcal } : {}),
      ...(metrics.exerciseMinutes ? { exerciseMinutes: MOCK_BASELINE.exerciseMinutes } : {}),
      ...(metrics.standHours ? { standHours: MOCK_BASELINE.standHours } : {}),
    },
    ...(metrics.sleepDuration
      ? {
          sleep: {
            durationMinutes: MOCK_BASELINE.sleepDuration,
          },
        }
      : {}),
    source: 'ios-healthkit-mock',
    generatedAt: now.toISOString(),
  };
}

export function filterHealthBridgeSummary(
  summary: HealthBridgeSummary,
  metrics: Record<HealthBridgeMetricKey, boolean>,
): HealthBridgeSummary {
  return {
    ...summary,
    activity: {
      ...(metrics.steps && typeof summary.activity.steps === 'number' ? { steps: summary.activity.steps } : {}),
      ...(metrics.activeEnergyKcal && typeof summary.activity.activeEnergyKcal === 'number'
        ? { activeEnergyKcal: summary.activity.activeEnergyKcal }
        : {}),
      ...(metrics.exerciseMinutes && typeof summary.activity.exerciseMinutes === 'number'
        ? { exerciseMinutes: summary.activity.exerciseMinutes }
        : {}),
      ...(metrics.standHours && typeof summary.activity.standHours === 'number'
        ? { standHours: summary.activity.standHours }
        : {}),
    },
    ...(metrics.sleepDuration && summary.sleep ? { sleep: summary.sleep } : {}),
  };
}
