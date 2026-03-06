import { NativeModules, Platform } from 'react-native';

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
}

const nativeBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;

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
    return 'idle';
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
    return 'authorized';
  }

  const selectedMetrics =
    metrics && metrics.length > 0
      ? metrics
      : ['steps', 'activeEnergyKcal', 'exerciseMinutes', 'standHours', 'sleepDuration'];
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

  const selectedMetrics =
    metrics && metrics.length > 0
      ? metrics
      : ['steps', 'activeEnergyKcal', 'exerciseMinutes', 'standHours', 'sleepDuration'];
  return nativeBridge.getHealthBridgeSummary(
    JSON.stringify({
      metrics: selectedMetrics,
    }),
  );
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
