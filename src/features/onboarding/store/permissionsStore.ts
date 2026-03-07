import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { NativeModules, Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

export type PermissionState = 'undetermined' | 'granted' | 'denied' | 'requested' | 'unavailable';
export type PermissionKey = 'camera' | 'photos' | 'microphone' | 'localNetwork';

export interface PermissionSnapshot {
  camera: PermissionState;
  photos: PermissionState;
  microphone: PermissionState;
  localNetwork: PermissionState;
}

interface LocalNetworkAuthorizationResponse {
  status?: string;
}

interface ClawSurfaceBridgeModule {
  requestLocalNetworkPermission?: (payload: string) => Promise<LocalNetworkAuthorizationResponse>;
}

interface PermissionStoreState {
  permissions: PermissionSnapshot;
  isHydrated: boolean;
  isRequesting: boolean;
  isPreflightingLocalNetwork: boolean;
  refreshPermissions: () => Promise<PermissionSnapshot>;
  requestRequiredPermissions: (options?: { host?: string | null }) => Promise<PermissionSnapshot>;
  preflightLocalNetworkPermission: (options?: { host?: string | null }) => Promise<PermissionState>;
  hasRequiredPermissions: () => boolean;
  getMissingPermissions: (snapshot?: PermissionSnapshot) => PermissionKey[];
}

const nativeBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;

const DEFAULT_PERMISSIONS: PermissionSnapshot = {
  camera: 'undetermined',
  photos: 'undetermined',
  microphone: 'undetermined',
  localNetwork: Platform.OS === 'ios' ? 'undetermined' : 'unavailable',
};

function toPermissionState(status: string): PermissionState {
  if (status === 'granted' || status === 'limited') {
    return 'granted';
  }

  if (status === 'denied') {
    return 'denied';
  }

  if (status === 'requested') {
    return 'requested';
  }

  if (status === 'unavailable') {
    return 'unavailable';
  }

  return 'undetermined';
}

async function readPermissionSnapshot(currentLocalNetwork: PermissionState): Promise<PermissionSnapshot> {
  const [cameraPermission, mediaPermission, microphonePermission] = await Promise.all([
    ImagePicker.getCameraPermissionsAsync(),
    ImagePicker.getMediaLibraryPermissionsAsync(),
    getRecordingPermissionsAsync(),
  ]);

  return {
    camera: toPermissionState(cameraPermission.status),
    photos: toPermissionState(mediaPermission.status),
    microphone: toPermissionState(microphonePermission.status),
    localNetwork: currentLocalNetwork,
  };
}

function getMissingPermissions(permissions: PermissionSnapshot): PermissionKey[] {
  const missing: PermissionKey[] = [];

  if (permissions.camera !== 'granted') {
    missing.push('camera');
  }

  if (permissions.microphone !== 'granted') {
    missing.push('microphone');
  }

  if (permissions.localNetwork === 'undetermined') {
    missing.push('localNetwork');
  }

  return missing;
}

function normalizeLocalNetworkState(status: string | undefined, previousState: PermissionState): PermissionState {
  if (status === 'granted') {
    return 'granted';
  }
  if (status === 'denied') {
    return 'denied';
  }
  if (status === 'requested') {
    return 'requested';
  }
  if (status === 'unavailable') {
    return 'unavailable';
  }
  return previousState === 'undetermined' ? 'requested' : previousState;
}

async function triggerLocalNetworkPermissionPreflight(
  previousState: PermissionState,
  options?: { host?: string | null },
): Promise<PermissionState> {
  if (Platform.OS !== 'ios') {
    return 'unavailable';
  }

  if (!nativeBridge?.requestLocalNetworkPermission) {
    return previousState === 'undetermined' ? 'requested' : previousState;
  }

  try {
    const payload = await nativeBridge.requestLocalNetworkPermission(
      JSON.stringify({
        host: options?.host?.trim() || undefined,
      }),
    );
    return normalizeLocalNetworkState(payload?.status, previousState);
  } catch {
    return previousState === 'undetermined' ? 'requested' : previousState;
  }
}

export const usePermissionsStore = create<PermissionStoreState>()(
  persist(
    (set, get) => ({
      permissions: DEFAULT_PERMISSIONS,
      isHydrated: false,
      isRequesting: false,
      isPreflightingLocalNetwork: false,

      refreshPermissions: async () => {
        const nextPermissions = await readPermissionSnapshot(get().permissions.localNetwork);
        set({ permissions: nextPermissions });
        return nextPermissions;
      },

      requestRequiredPermissions: async (options) => {
        set({ isRequesting: true });

        try {
          const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
          const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          const microphonePermission = await requestRecordingPermissionsAsync();
          set({ isPreflightingLocalNetwork: true });
          const localNetwork = await triggerLocalNetworkPermissionPreflight(get().permissions.localNetwork, options);

          const nextPermissions: PermissionSnapshot = {
            camera: toPermissionState(cameraPermission.status),
            photos: toPermissionState(mediaPermission.status),
            microphone: toPermissionState(microphonePermission.status),
            localNetwork,
          };

          set({ permissions: nextPermissions });
          return nextPermissions;
        } finally {
          set({ isRequesting: false, isPreflightingLocalNetwork: false });
        }
      },

      preflightLocalNetworkPermission: async (options) => {
        set({ isPreflightingLocalNetwork: true });
        try {
          const localNetwork = await triggerLocalNetworkPermissionPreflight(get().permissions.localNetwork, options);
          set((state) => ({
            permissions: {
              ...state.permissions,
              localNetwork,
            },
          }));
          return localNetwork;
        } finally {
          set({ isPreflightingLocalNetwork: false });
        }
      },

      hasRequiredPermissions: () => getMissingPermissions(get().permissions).length === 0,

      getMissingPermissions: (snapshot) => getMissingPermissions(snapshot ?? get().permissions),
    }),
    {
      name: STORAGE_KEYS.PERMISSION_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        permissions: state.permissions,
      }),
      onRehydrateStorage: () => () => {
        usePermissionsStore.setState({
          isHydrated: true,
        });
      },
    },
  ),
);
