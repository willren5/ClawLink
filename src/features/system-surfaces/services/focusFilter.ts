import { NativeModules, Platform } from 'react-native';

import { useConnectionStore } from '../../connection/store/connectionStore';

export type FocusFilterMode = 'all' | 'work' | 'personal';
export type GatewayProfileClass = 'production' | 'nonproduction' | 'unknown';

export interface FocusFilterPolicy {
  mode: FocusFilterMode;
  activeProfileClass: GatewayProfileClass;
  allowNotifications: boolean;
  allowSystemSurfaces: boolean;
  allowSpotlight: boolean;
  suppressionReason: string | null;
}

interface ClawSurfaceBridgeModule {
  getFocusFilterMode?: () => Promise<string>;
}

const surfaceBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;

export function isProductionProfileName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes('dev') ||
    normalized.includes('test') ||
    normalized.includes('staging') ||
    normalized.includes('sandbox') ||
    normalized.includes('preview') ||
    normalized.includes('local')
  ) {
    return false;
  }

  return true;
}

export function resolveActiveProfileClass(): GatewayProfileClass {
  const connection = useConnectionStore.getState();
  const activeProfile = connection.activeProfileId
    ? connection.profiles.find((item) => item.id === connection.activeProfileId)
    : null;

  if (!activeProfile) {
    return 'unknown';
  }

  return isProductionProfileName(activeProfile.name) ? 'production' : 'nonproduction';
}

export async function getFocusFilterMode(): Promise<FocusFilterMode> {
  if (Platform.OS !== 'ios' || !surfaceBridge?.getFocusFilterMode) {
    return 'all';
  }

  try {
    const raw = (await surfaceBridge.getFocusFilterMode())?.trim().toLowerCase();
    if (raw === 'all' || raw === 'work' || raw === 'personal') {
      return raw;
    }
  } catch {
    // Best effort.
  }

  return 'all';
}

export async function resolveFocusFilterPolicy(): Promise<FocusFilterPolicy> {
  const mode = await getFocusFilterMode();
  const activeProfileClass = resolveActiveProfileClass();

  if (mode === 'personal') {
    return {
      mode,
      activeProfileClass,
      allowNotifications: false,
      allowSystemSurfaces: false,
      allowSpotlight: false,
      suppressionReason: 'Hidden by Personal Focus',
    };
  }

  if (mode === 'work' && activeProfileClass === 'nonproduction') {
    return {
      mode,
      activeProfileClass,
      allowNotifications: false,
      allowSystemSurfaces: false,
      allowSpotlight: false,
      suppressionReason: 'Hidden for non-production gateway',
    };
  }

  return {
    mode,
    activeProfileClass,
    allowNotifications: true,
    allowSystemSurfaces: true,
    allowSpotlight: true,
    suppressionReason: null,
  };
}
