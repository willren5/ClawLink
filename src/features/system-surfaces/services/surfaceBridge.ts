import { NativeModules, Platform } from 'react-native';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { setObject } from '../../../lib/mmkv/storage';
import { getVisibleGatewayProfiles } from '../../connection/debugProfile';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import { aggregateSystemSnapshot } from './snapshotAggregator';
import { resolveFocusFilterPolicy } from './focusFilter';
import type {
  MultiGatewaySurfaceState,
  SurfaceConnectionState,
  SystemSurfacePayload,
  SystemSurfaceSnapshot,
} from '../types';

interface ClawSurfaceBridgeModule {
  publishLiveActivity?: (payload: string) => Promise<void>;
  publishWidgetState?: (payload: string) => Promise<void>;
  publishMultiGatewayState?: (payload: string) => Promise<void>;
  updateSurfacePreferences?: (payload: string) => Promise<void>;
  endLiveActivity?: () => Promise<void>;
}

const nativeBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;
let lastNativeSnapshot: SystemSurfaceSnapshot | null = null;

export function buildSystemSurfaceSnapshot(
  _input?: {
    connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
    activeSessions: number;
    activeChannels: number;
    pendingQueue: number;
    language?: 'zh' | 'en';
  },
): SystemSurfaceSnapshot {
  return aggregateSystemSnapshot();
}

function mapConnectionState(
  status: 'connected' | 'connecting' | 'disconnected' | 'error',
): SurfaceConnectionState {
  if (status === 'connected') {
    return 'online';
  }
  if (status === 'connecting') {
    return 'degraded';
  }
  return 'offline';
}

export function buildMultiGatewaySurfaceState(): MultiGatewaySurfaceState {
  const connection = useConnectionStore.getState();
  const visibleProfiles = getVisibleGatewayProfiles(connection.profiles);
  const updatedAt = Date.now();

  return {
    schemaVersion: 1,
    updatedAt,
    gateways: visibleProfiles.slice(0, 3).map((profile) => {
      const background = connection.backgroundHealthStatus[profile.id];
      const isActive = profile.id === connection.activeProfileId;
      return {
        gatewayId: profile.id,
        name: profile.name,
        status: isActive ? mapConnectionState(connection.connectionStatus) : mapConnectionState(background?.status ?? 'disconnected'),
        lastCheck: isActive ? connection.lastHealthCheckAt ?? updatedAt : background?.lastCheck ?? 0,
        isActive,
      };
    }),
  };
}

function buildSystemSurfacePayload(snapshot: SystemSurfaceSnapshot): SystemSurfacePayload {
  if (!lastNativeSnapshot || lastNativeSnapshot.schemaVersion !== snapshot.schemaVersion) {
    lastNativeSnapshot = snapshot;
    return {
      kind: 'full',
      schemaVersion: snapshot.schemaVersion,
      timestamp: snapshot.timestamp,
      snapshot,
    };
  }

  const changedKeys = (Object.keys(snapshot) as Array<keyof SystemSurfaceSnapshot>).filter((key) => {
    const previousValue = lastNativeSnapshot?.[key];
    const nextValue = snapshot[key];
    return JSON.stringify(previousValue) !== JSON.stringify(nextValue);
  });

  const patchSnapshot: Partial<SystemSurfaceSnapshot> = {};
  for (const key of changedKeys) {
    Object.assign(patchSnapshot, {
      [key]: snapshot[key],
    });
  }

  lastNativeSnapshot = snapshot;

  return {
    kind: 'patch',
    schemaVersion: snapshot.schemaVersion,
    timestamp: snapshot.timestamp,
    changedKeys,
    snapshot: patchSnapshot,
  };
}

export async function publishSystemSurfaces(snapshot: SystemSurfaceSnapshot): Promise<void> {
  setObject(STORAGE_KEYS.SYSTEM_SURFACE_SNAPSHOT, snapshot);
  const multiGatewayState = buildMultiGatewaySurfaceState();
  setObject(STORAGE_KEYS.MULTI_GATEWAY_SURFACE_STATE, multiGatewayState);

  const preferences = useAppPreferencesStore.getState();

  if (Platform.OS !== 'ios') {
    return;
  }

  if (!nativeBridge) {
    throw new Error('System surface bridge is unavailable on iOS runtime.');
  }

  const focusPolicy = await resolveFocusFilterPolicy();
  const payload = JSON.stringify(buildSystemSurfacePayload(snapshot));
  const multiGatewayPayload = JSON.stringify(multiGatewayState);
  const preferencesPayload = JSON.stringify({
    liveActivityEnabled: preferences.liveActivityEnabled,
    dynamicIslandEnabled: preferences.dynamicIslandEnabled,
    widgetEnabled: preferences.widgetEnabled,
    activeProfileClass: focusPolicy.activeProfileClass,
  });

  const preferenceResult = await Promise.allSettled([nativeBridge.updateSurfacePreferences?.(preferencesPayload)]).then(
    (value) => value[0],
  );
  const widgetSyncResult = await Promise.allSettled([nativeBridge.publishWidgetState?.(payload)]).then((value) => value[0]);
  const liveActivityResult = await Promise.allSettled([
    focusPolicy.allowSystemSurfaces && preferences.liveActivityEnabled
      ? nativeBridge.publishLiveActivity?.(payload)
      : nativeBridge.endLiveActivity?.(),
  ]).then((value) => value[0]);
  const multiGatewayResult = await Promise.allSettled([
    preferences.widgetEnabled ? nativeBridge.publishMultiGatewayState?.(multiGatewayPayload) : Promise.resolve(),
  ]).then((value) => value[0]);

  const errors: string[] = [];
  if (preferenceResult?.status === 'rejected') {
    errors.push('Failed to sync system surface preferences.');
  }
  if (widgetSyncResult?.status === 'rejected') {
    errors.push('Widget snapshot sync failed.');
  }
  if (preferences.liveActivityEnabled && liveActivityResult?.status === 'rejected') {
    errors.push('Live Activity update failed.');
  }
  if (preferences.widgetEnabled && multiGatewayResult?.status === 'rejected') {
    errors.push('Multi-gateway widget update failed.');
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
}

export async function stopSystemLiveActivity(): Promise<void> {
  if (Platform.OS !== 'ios' || !nativeBridge?.endLiveActivity) {
    return;
  }

  try {
    await nativeBridge.endLiveActivity();
  } catch {
    // Best effort.
  }
}
