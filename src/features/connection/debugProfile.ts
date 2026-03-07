import type { GatewayProfile } from './types';
import { isHiddenDebugProfileEnabled } from '../../lib/features/featureFlags';

export const HIDDEN_DEBUG_PROFILE_ID = 'gw_hidden_debug_user';
export const HIDDEN_DEBUG_PROFILE_NAME = '__hidden_debug_user__';
export const HIDDEN_DEBUG_IP = '999.999.999.999';
export const HIDDEN_DEBUG_PORT = 65535;
export const HIDDEN_DEBUG_TOKEN =
  'ocg_debug_token__never_real__ip_999_999_999_999__for_bug_repro_only';

export function createHiddenDebugProfile(now = Date.now()): GatewayProfile {
  return {
    id: HIDDEN_DEBUG_PROFILE_ID,
    name: HIDDEN_DEBUG_PROFILE_NAME,
    host: HIDDEN_DEBUG_IP,
    port: HIDDEN_DEBUG_PORT,
    tls: false,
    tokenRef: HIDDEN_DEBUG_PROFILE_ID,
    createdAt: now,
    updatedAt: now,
    hidden: true,
  };
}

export function isHiddenDebugProfile(profile: GatewayProfile): boolean {
  return profile.hidden === true || profile.id === HIDDEN_DEBUG_PROFILE_ID;
}

export function getVisibleGatewayProfiles(profiles: GatewayProfile[]): GatewayProfile[] {
  return profiles.filter((profile) => !isHiddenDebugProfile(profile));
}

export function ensureHiddenDebugProfile(profiles: GatewayProfile[]): GatewayProfile[] {
  if (!isHiddenDebugProfileEnabled()) {
    return profiles.filter((profile) => !isHiddenDebugProfile(profile));
  }

  const now = Date.now();
  const normalized = profiles.map((profile) => {
    if (!isHiddenDebugProfile(profile)) {
      return profile;
    }

    return {
      ...profile,
      id: HIDDEN_DEBUG_PROFILE_ID,
      name: HIDDEN_DEBUG_PROFILE_NAME,
      host: HIDDEN_DEBUG_IP,
      port: HIDDEN_DEBUG_PORT,
      tls: false,
      tokenRef: HIDDEN_DEBUG_PROFILE_ID,
      hidden: true,
      createdAt: Number.isFinite(profile.createdAt) ? profile.createdAt : now,
      updatedAt: Number.isFinite(profile.updatedAt) ? profile.updatedAt : now,
    };
  });

  const deduped: GatewayProfile[] = [];
  for (const profile of normalized) {
    if (profile.id === HIDDEN_DEBUG_PROFILE_ID && deduped.some((item) => item.id === HIDDEN_DEBUG_PROFILE_ID)) {
      continue;
    }
    deduped.push(profile);
  }

  if (deduped.some((profile) => profile.id === HIDDEN_DEBUG_PROFILE_ID)) {
    return deduped;
  }

  return [...deduped, createHiddenDebugProfile(now)];
}
