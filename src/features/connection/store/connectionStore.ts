import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { resolveGatewayProfileAuth, toGatewayTokenState } from '../../../lib/api/gatewayAuth';
import { isHiddenDebugProfileEnabled } from '../../../lib/features/featureFlags';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import { saveGatewayToken, deleteGatewayToken } from '../../../lib/secure/tokenVault';
import { buildGatewayBaseUrl, normalizeHost, parseGatewayEndpointInput } from '../../../lib/utils/network';
import {
  connectToGateway,
  createGatewayProfile,
  pingGatewayHealth,
  ConnectionError,
} from '../services/connectionService';
import {
  ensureHiddenDebugProfile,
  getVisibleGatewayProfiles,
  HIDDEN_DEBUG_TOKEN,
  HIDDEN_DEBUG_PROFILE_ID,
  isHiddenDebugProfile,
} from '../debugProfile';
import type { BackgroundGatewayHealth, ConnectGatewayInput, ConnectionStatus, GatewayProfile } from '../types';

const MAX_GATEWAY_PROFILES = 5;

interface ConnectionStoreState {
  profiles: GatewayProfile[];
  activeProfileId: string | null;
  connectionStatus: ConnectionStatus;
  backgroundHealthStatus: Record<string, BackgroundGatewayHealth>;
  disconnectedSince: number | null;
  lastHealthCheckAt: number | null;
  lastError: string | null;
  handshakeDeviceCount: number;
  tokenExpiresAt: number | null;
  tokenExpiringSoon: boolean;
  tokenRefreshAvailable: boolean | null;
  isHydrated: boolean;
  disconnectBannerVisible: boolean;
  connectAndSaveProfile: (input: ConnectGatewayInput) => Promise<void>;
  switchGatewayProfile: (profileId: string) => Promise<void>;
  removeGatewayProfile: (profileId: string) => Promise<void>;
  pingActiveGateway: () => Promise<void>;
  pollAllGateways: () => Promise<void>;
  refreshGatewayFleet: () => Promise<void>;
  disconnect: () => void;
  dismissDisconnectBanner: () => void;
}

function formatConnectionError(error: unknown): string {
  if (error instanceof ConnectionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown connection error';
}

function sortProfiles(profiles: GatewayProfile[]): GatewayProfile[] {
  return [...profiles].sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveDisconnectedSince(
  currentStatus: ConnectionStatus,
  currentDisconnectedSince: number | null,
  nextStatus: ConnectionStatus,
): number | null {
  if (nextStatus === 'connected') {
    return null;
  }

  if (currentStatus === 'connected') {
    return currentDisconnectedSince ?? Date.now();
  }

  return currentDisconnectedSince;
}

function sanitizeGatewayProfile(profile: GatewayProfile): GatewayProfile | null {
  const id = typeof profile.id === 'string' ? profile.id.trim() : '';
  const hostInput = typeof profile.host === 'string' ? profile.host.trim() : '';
  const parsedEndpoint = parseGatewayEndpointInput(hostInput);
  const host = parsedEndpoint.host || normalizeHost(hostInput);
  if (!id || !host) {
    return null;
  }

  const portFromHost = parsedEndpoint.port;
  const port =
    portFromHost ??
    (typeof profile.port === 'number' && Number.isInteger(profile.port) && profile.port >= 1 && profile.port <= 65535
      ? profile.port
      : 18789);
  const tls = Boolean(profile.tls);
  const createdAt = typeof profile.createdAt === 'number' && Number.isFinite(profile.createdAt) ? profile.createdAt : Date.now();
  const updatedAt = typeof profile.updatedAt === 'number' && Number.isFinite(profile.updatedAt) ? profile.updatedAt : createdAt;
  const lastConnectedAt =
    typeof profile.lastConnectedAt === 'number' && Number.isFinite(profile.lastConnectedAt)
      ? profile.lastConnectedAt
      : updatedAt;
  const tokenRef = typeof profile.tokenRef === 'string' && profile.tokenRef.trim().length > 0 ? profile.tokenRef.trim() : id;
  const name = typeof profile.name === 'string' && profile.name.trim().length > 0 ? profile.name.trim() : `${host}:${port}`;
  const hidden = profile.hidden === true;

  return {
    id,
    name,
    host,
    port,
    tls,
    tokenRef,
    createdAt,
    updatedAt,
    lastConnectedAt,
    hidden,
  };
}

function sanitizeBackgroundGatewayHealth(value: BackgroundGatewayHealth): BackgroundGatewayHealth | null {
  const profileId = value.profileId.trim();
  const profileName = value.profileName.trim();
  if (!profileId || !profileName) {
    return null;
  }

  return {
    profileId,
    profileName,
    status:
      value.status === 'connected' || value.status === 'connecting' || value.status === 'error'
        ? value.status
        : 'disconnected',
    lastCheck: Number.isFinite(value.lastCheck) ? value.lastCheck : 0,
    lastError: typeof value.lastError === 'string' && value.lastError.trim() ? value.lastError.trim() : null,
  };
}

export const useConnectionStore = create<ConnectionStoreState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      connectionStatus: 'disconnected',
      backgroundHealthStatus: {},
      disconnectedSince: null,
      lastHealthCheckAt: null,
      lastError: null,
      handshakeDeviceCount: 0,
      tokenExpiresAt: null,
      tokenExpiringSoon: false,
      tokenRefreshAvailable: null,
      isHydrated: false,
      disconnectBannerVisible: false,

      connectAndSaveProfile: async (input) => {
        set((state) => ({
          connectionStatus: 'connecting',
          disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'connecting'),
          lastError: null,
          disconnectBannerVisible: false,
        }));

        try {
          const connection = await connectToGateway(input);
          const normalizedHost = normalizeHost(input.host);
          const resolvedTls = typeof connection.resolvedTls === 'boolean' ? connection.resolvedTls : input.tls;

          const existingProfile = get().profiles.find(
            (profile) =>
              !isHiddenDebugProfile(profile) &&
              profile.host === normalizedHost &&
              profile.port === input.port &&
              profile.tls === resolvedTls,
          );

          if (!existingProfile && getVisibleGatewayProfiles(get().profiles).length >= MAX_GATEWAY_PROFILES) {
            throw new Error(`You can save up to ${MAX_GATEWAY_PROFILES} gateway profiles.`);
          }

          const profile = existingProfile
            ? {
                ...existingProfile,
                name: input.name?.trim() || existingProfile.name,
                tls: resolvedTls,
                updatedAt: Date.now(),
                lastConnectedAt: Date.now(),
              }
            : createGatewayProfile({
                ...input,
                tls: resolvedTls,
              });

          await saveGatewayToken(profile.tokenRef, input.token);

          const nextProfiles = existingProfile
            ? get().profiles.map((item) => (item.id === existingProfile.id ? profile : item))
            : [...get().profiles, profile];

          set({
            profiles: sortProfiles(nextProfiles),
            activeProfileId: profile.id,
            connectionStatus: 'connected',
            backgroundHealthStatus: {},
            disconnectedSince: null,
            lastHealthCheckAt: Date.now(),
            handshakeDeviceCount: connection.devices.devices.length,
            tokenExpiresAt: null,
            tokenExpiringSoon: false,
            tokenRefreshAvailable: null,
            lastError: null,
            disconnectBannerVisible: false,
          });
        } catch (error: unknown) {
          set((state) => ({
            connectionStatus: 'error',
            disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'error'),
            lastError: formatConnectionError(error),
            disconnectBannerVisible: true,
          }));
          throw error;
        }
      },

      switchGatewayProfile: async (profileId) => {
        const targetProfile = get().profiles.find((profile) => profile.id === profileId);
        if (!targetProfile) {
          throw new Error('Gateway profile not found');
        }

        set((state) => ({
          connectionStatus: 'connecting',
          disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'connecting'),
          lastError: null,
          disconnectBannerVisible: false,
        }));

        try {
          const auth = await resolveGatewayProfileAuth({
            profile: targetProfile,
            previousRefreshAvailable: get().tokenRefreshAvailable,
          });
          await pingGatewayHealth(auth.baseUrl, auth.token);

          const updatedProfile: GatewayProfile = {
            ...targetProfile,
            updatedAt: Date.now(),
            lastConnectedAt: Date.now(),
          };

          set({
            profiles: sortProfiles(
              get().profiles.map((profile) => (profile.id === updatedProfile.id ? updatedProfile : profile)),
            ),
            activeProfileId: profileId,
            connectionStatus: 'connected',
            backgroundHealthStatus: {
              ...get().backgroundHealthStatus,
              [profileId]: {
                profileId,
                profileName: updatedProfile.name,
                status: 'connected',
                lastCheck: Date.now(),
                lastError: null,
              },
            },
            disconnectedSince: null,
            lastHealthCheckAt: Date.now(),
            lastError: null,
            disconnectBannerVisible: false,
            ...toGatewayTokenState(auth.expiresAt, auth.refreshAvailable, get().tokenRefreshAvailable),
          });
        } catch (error: unknown) {
          set((state) => ({
            connectionStatus: 'error',
            disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'error'),
            lastError: formatConnectionError(error),
            disconnectBannerVisible: true,
          }));
          throw error;
        }
      },

      removeGatewayProfile: async (profileId) => {
        const targetProfile = get().profiles.find((profile) => profile.id === profileId);
        if (!targetProfile || isHiddenDebugProfile(targetProfile)) {
          return;
        }

        await deleteGatewayToken(targetProfile.tokenRef);

        const wasActiveRemoved = get().activeProfileId === profileId;
        const remainingProfiles = get().profiles.filter((profile) => profile.id !== profileId);
        const nextActiveId =
          wasActiveRemoved ? getVisibleGatewayProfiles(remainingProfiles).at(0)?.id ?? null : get().activeProfileId;

        set((state) => {
          const nextStatus: ConnectionStatus = wasActiveRemoved ? 'disconnected' : state.connectionStatus;
          return {
            profiles: sortProfiles(remainingProfiles),
            activeProfileId: nextActiveId,
            connectionStatus: nextStatus,
            backgroundHealthStatus: Object.fromEntries(
              Object.entries(state.backgroundHealthStatus).filter(([id]) => id !== profileId),
            ),
            disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, nextStatus),
            lastHealthCheckAt: wasActiveRemoved ? null : state.lastHealthCheckAt,
            handshakeDeviceCount: wasActiveRemoved ? 0 : state.handshakeDeviceCount,
            tokenExpiresAt: wasActiveRemoved ? null : state.tokenExpiresAt,
            tokenExpiringSoon: wasActiveRemoved ? false : state.tokenExpiringSoon,
            tokenRefreshAvailable: wasActiveRemoved ? null : state.tokenRefreshAvailable,
            disconnectBannerVisible: false,
            lastError: wasActiveRemoved ? null : state.lastError,
          };
        });
      },

      pingActiveGateway: async () => {
        const { activeProfileId, profiles } = get();
        if (!activeProfileId) {
          return;
        }

        const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
        if (!activeProfile) {
          return;
        }

        try {
          const auth = await resolveGatewayProfileAuth({
            profile: activeProfile,
            previousRefreshAvailable: get().tokenRefreshAvailable,
          });
          await pingGatewayHealth(auth.baseUrl, auth.token);
          set({
            connectionStatus: 'connected',
            backgroundHealthStatus: {
              ...get().backgroundHealthStatus,
              [activeProfile.id]: {
                profileId: activeProfile.id,
                profileName: activeProfile.name,
                status: 'connected',
                lastCheck: Date.now(),
                lastError: null,
              },
            },
            disconnectedSince: null,
            lastHealthCheckAt: Date.now(),
            disconnectBannerVisible: false,
            ...toGatewayTokenState(auth.expiresAt, auth.refreshAvailable, get().tokenRefreshAvailable),
          });
        } catch (error: unknown) {
          set((state) => ({
            connectionStatus: 'error',
            disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'error'),
            lastError: formatConnectionError(error),
            disconnectBannerVisible: true,
          }));
        }
      },

      pollAllGateways: async () => {
        const visibleProfiles = getVisibleGatewayProfiles(get().profiles);
        const inactiveProfiles = visibleProfiles.filter((profile) => profile.id !== get().activeProfileId);

        if (inactiveProfiles.length === 0) {
          return;
        }

        const checks = await Promise.all(
          inactiveProfiles.map(async (profile): Promise<[string, BackgroundGatewayHealth]> => {
            const now = Date.now();

            try {
              const auth = await resolveGatewayProfileAuth({
                profile,
                previousRefreshAvailable: null,
              });
              await pingGatewayHealth(auth.baseUrl, auth.token);

              return [
                profile.id,
                {
                  profileId: profile.id,
                  profileName: profile.name,
                  status: 'connected',
                  lastCheck: now,
                  lastError: null,
                },
              ];
            } catch (error: unknown) {
              return [
                profile.id,
                {
                  profileId: profile.id,
                  profileName: profile.name,
                  status: 'error',
                  lastCheck: now,
                  lastError: formatConnectionError(error),
                },
              ];
            }
          }),
        );

        set((state) => ({
          backgroundHealthStatus: {
            ...state.backgroundHealthStatus,
            ...Object.fromEntries(checks),
          },
        }));
      },

      refreshGatewayFleet: async () => {
        await Promise.allSettled([get().pingActiveGateway(), get().pollAllGateways()]);
      },

      disconnect: () => {
        set((state) => ({
          connectionStatus: 'disconnected',
          disconnectedSince: deriveDisconnectedSince(state.connectionStatus, state.disconnectedSince, 'disconnected'),
          activeProfileId: null,
          backgroundHealthStatus: {},
          lastError: null,
          disconnectBannerVisible: false,
          tokenExpiresAt: null,
          tokenExpiringSoon: false,
          tokenRefreshAvailable: null,
        }));
      },

      dismissDisconnectBanner: () => {
        set({ disconnectBannerVisible: false });
      },
    }),
    {
      name: STORAGE_KEYS.CONNECTION_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
        backgroundHealthStatus: state.backgroundHealthStatus,
      }),
      onRehydrateStorage: () => () => {
        const state = useConnectionStore.getState();
        const rawProfiles = Array.isArray(state.profiles) ? state.profiles : [];
        const sanitizedBaseProfiles = rawProfiles
          .map((profile) => sanitizeGatewayProfile(profile))
          .filter((profile): profile is GatewayProfile => profile !== null);
        const sanitizedProfiles = sortProfiles(
          __DEV__ ? ensureHiddenDebugProfile(sanitizedBaseProfiles) : sanitizedBaseProfiles.filter((profile) => !isHiddenDebugProfile(profile)),
        );
        const nextActiveProfile =
          typeof state.activeProfileId === 'string'
            ? sanitizedProfiles.find((profile) => profile.id === state.activeProfileId)
            : null;
        const activeProfileId =
          nextActiveProfile && !isHiddenDebugProfile(nextActiveProfile) ? nextActiveProfile.id : null;
        const backgroundHealthStatus = Object.fromEntries(
          Object.entries(
            (state as unknown as { backgroundHealthStatus?: Record<string, BackgroundGatewayHealth> }).backgroundHealthStatus ?? {},
          )
            .map(([profileId, item]) =>
              sanitizeBackgroundGatewayHealth({
                profileId,
                profileName: item.profileName,
                status: item.status,
                lastCheck: item.lastCheck,
                lastError: item.lastError,
              }),
            )
            .filter((item): item is BackgroundGatewayHealth => item !== null)
            .map((item) => [item.profileId, item] as const),
        );

        useConnectionStore.setState({
          profiles: sanitizedProfiles,
          activeProfileId,
          isHydrated: true,
          connectionStatus: 'disconnected',
          backgroundHealthStatus,
          disconnectedSince: null,
          handshakeDeviceCount: 0,
          tokenExpiresAt: null,
          tokenExpiringSoon: false,
          tokenRefreshAvailable: null,
          lastError: null,
          disconnectBannerVisible: false,
        });

        if (__DEV__ && isHiddenDebugProfileEnabled()) {
          void saveGatewayToken(HIDDEN_DEBUG_PROFILE_ID, HIDDEN_DEBUG_TOKEN).catch(() => {
            // Best effort seed for hidden debug profile.
          });
        }
      },
    },
  ),
);
