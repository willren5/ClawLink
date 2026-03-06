import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

export type PermissionState = 'undetermined' | 'granted' | 'denied';
export type PermissionKey = 'camera' | 'photos' | 'microphone';

export interface PermissionSnapshot {
  camera: PermissionState;
  photos: PermissionState;
  microphone: PermissionState;
}

interface PermissionStoreState {
  permissions: PermissionSnapshot;
  isHydrated: boolean;
  isRequesting: boolean;
  isPreflightingLocalNetwork: boolean;
  localNetworkPreflightDone: boolean;
  refreshPermissions: () => Promise<PermissionSnapshot>;
  requestRequiredPermissions: () => Promise<PermissionSnapshot>;
  preflightLocalNetworkPermission: () => Promise<void>;
  hasRequiredPermissions: () => boolean;
  getMissingPermissions: (snapshot?: PermissionSnapshot) => PermissionKey[];
}

const DEFAULT_PERMISSIONS: PermissionSnapshot = {
  camera: 'undetermined',
  photos: 'undetermined',
  microphone: 'undetermined',
};

function toPermissionState(status: string): PermissionState {
  if (status === 'granted' || status === 'limited') {
    return 'granted';
  }

  if (status === 'denied') {
    return 'denied';
  }

  return 'undetermined';
}

async function readPermissionSnapshot(): Promise<PermissionSnapshot> {
  const [cameraPermission, mediaPermission, microphonePermission] = await Promise.all([
    ImagePicker.getCameraPermissionsAsync(),
    ImagePicker.getMediaLibraryPermissionsAsync(),
    getRecordingPermissionsAsync(),
  ]);

  return {
    camera: toPermissionState(cameraPermission.status),
    photos: toPermissionState(mediaPermission.status),
    microphone: toPermissionState(microphonePermission.status),
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

  return missing;
}

async function triggerLocalNetworkPermissionPreflight(): Promise<void> {
  const probes = [
    'http://192.168.0.1',
    'http://192.168.1.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
  ];

  await Promise.allSettled(
    probes.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, 1200);

      try {
        await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
        });
      } catch {
        // This call is only used to trigger iOS local-network permission prompt.
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

export const usePermissionsStore = create<PermissionStoreState>()(
  persist(
    (set, get) => ({
      permissions: DEFAULT_PERMISSIONS,
      isHydrated: false,
      isRequesting: false,
      isPreflightingLocalNetwork: false,
      localNetworkPreflightDone: false,

      refreshPermissions: async () => {
        const nextPermissions = await readPermissionSnapshot();
        set({ permissions: nextPermissions });
        return nextPermissions;
      },

      requestRequiredPermissions: async () => {
        set({ isRequesting: true });

        try {
          const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
          const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          const microphonePermission = await requestRecordingPermissionsAsync();
          if (!get().localNetworkPreflightDone) {
            // Non-blocking: avoid delaying onboarding when iOS network stack is slow.
            void triggerLocalNetworkPermissionPreflight()
              .then(() => {
                set({ localNetworkPreflightDone: true });
              })
              .catch(() => {
                // Best effort. We'll retry next app launch if needed.
              });
          }

          const nextPermissions: PermissionSnapshot = {
            camera: toPermissionState(cameraPermission.status),
            photos: toPermissionState(mediaPermission.status),
            microphone: toPermissionState(microphonePermission.status),
          };

          set({ permissions: nextPermissions });
          return nextPermissions;
        } finally {
          set({ isRequesting: false });
        }
      },

      preflightLocalNetworkPermission: async () => {
        if (get().localNetworkPreflightDone) {
          return;
        }

        set({ isPreflightingLocalNetwork: true });
        try {
          await triggerLocalNetworkPermissionPreflight();
          set({ localNetworkPreflightDone: true });
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
        localNetworkPreflightDone: state.localNetworkPreflightDone,
      }),
      onRehydrateStorage: () => () => {
        usePermissionsStore.setState({
          isHydrated: true,
        });
      },
    },
  ),
);
