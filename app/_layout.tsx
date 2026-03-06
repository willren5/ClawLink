import 'react-native-url-polyfill/auto';

import { useCallback, useEffect, useState } from 'react';
import { AppState, Appearance, Linking, NativeModules, Platform, Pressable, Text, View, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { getAgents, restartAgent } from '../src/lib/api';
import { useAgentsRuntimeStore } from '../src/features/agents/store/agentsRuntimeStore';
import { useConnectionHeartbeat } from '../src/features/connection/hooks/useConnectionHeartbeat';
import { useConnectionStore } from '../src/features/connection/store/connectionStore';
import { useChatStore } from '../src/features/chat/store/chatStore';
import { useDashboardStore } from '../src/features/dashboard/store/dashboardStore';
import { parseGatewayImport } from '../src/features/connection/services/connectionImport';
import { startLocalAlertsMonitor } from '../src/features/notifications/services/localAlerts';
import {
  handleAlertNotificationResponse,
  registerAlertNotificationCategories,
} from '../src/features/notifications/services/notificationActions';
import { registerForPushAlerts } from '../src/features/notifications/services/pushRegistration';
import { usePermissionsStore } from '../src/features/onboarding/store/permissionsStore';
import { publishSystemSurfaces } from '../src/features/system-surfaces/services/surfaceBridge';
import { registerBackgroundRefreshTask, unregisterBackgroundRefreshTask } from '../src/features/system-surfaces/services/backgroundRefresh';
import { aggregateSystemSnapshot, subscribeSnapshotChanges } from '../src/features/system-surfaces/services/snapshotAggregator';
import { startSpotlightIndexing } from '../src/features/system-surfaces/services/spotlightIndexer';
import { useAppPreferencesStore } from '../src/features/settings/store/preferencesStore';
import { useI18n } from '../src/lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../src/theme/adaptiveStyles';

type DeepLinkRoute = '/(tabs)/chat' | '/(tabs)/monitor' | '/(tabs)/agents' | '/(tabs)/dashboard' | '/connection';

const DEEP_LINK_ROUTE_MAP: Record<string, DeepLinkRoute> = {
  chat: '/(tabs)/chat',
  monitor: '/(tabs)/monitor',
  agents: '/(tabs)/agents',
  dashboard: '/(tabs)/dashboard',
  connect: '/connection',
  connection: '/connection',
};
const SURFACE_REFRESH_INTERVAL_MS = 45_000;

interface ClawSurfaceBridgeModule {
  consumeControlRefreshRequest?: () => Promise<boolean>;
  consumePendingShortcutCommand?: () => Promise<string | null>;
}

const nativeSurfaceBridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;

interface PendingShortcutCommand {
  id?: string;
  kind: 'restart_agent' | 'send_message';
  agentId?: string | null;
  message?: string | null;
  createdAt?: number;
}

function resolveDeepLinkRoute(url: string): DeepLinkRoute | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'clawlink:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    const firstPathSegment = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? '';
    const key = host || firstPathSegment;
    return DEEP_LINK_ROUTE_MAP[key] ?? null;
  } catch {
    const normalized = url.toLowerCase();
    for (const [key, route] of Object.entries(DEEP_LINK_ROUTE_MAP)) {
      if (normalized.startsWith(`clawlink://${key}`) || normalized.startsWith(`clawlink:/${key}`)) {
        return route;
      }
    }
    return null;
  }
}

function extractConnectionRouteParams(url: string): Record<string, string> | null {
  const imported = parseGatewayImport(url);
  if (!imported) {
    return null;
  }

  const params: Record<string, string> = {};
  if (imported.host) {
    params.host = imported.host;
  }
  if (typeof imported.port === 'number') {
    params.port = String(imported.port);
  }
  if (imported.token) {
    params.token = imported.token;
  }
  if (typeof imported.tls === 'boolean') {
    params.tls = imported.tls ? 'true' : 'false';
  }
  if (imported.name) {
    params.name = imported.name;
  }

  return Object.keys(params).length > 0 ? params : null;
}

function DisconnectBanner(): JSX.Element | null {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const disconnectBannerVisible = useConnectionStore((state) => state.disconnectBannerVisible);
  const lastError = useConnectionStore((state) => state.lastError);
  const dismissDisconnectBanner = useConnectionStore((state) => state.dismissDisconnectBanner);

  if (!activeProfileId || !disconnectBannerVisible) {
    return null;
  }

  return (
    <View style={[styles.banner, { top: insets.top + 6 }]}>
      <View style={styles.bannerBody}>
        <Text style={styles.bannerTitle}>{t('root_gateway_disconnected_title')}</Text>
        {!!lastError && <Text style={styles.bannerText}>{lastError}</Text>}
      </View>
      <Pressable style={styles.bannerButton} onPress={dismissDisconnectBanner}>
        <Text style={styles.bannerButtonText}>{t('common_close')}</Text>
      </Pressable>
    </View>
  );
}

function RootNavigation(): JSX.Element {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const router = useRouter();
  const pathname = usePathname();
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const isHydrated = useConnectionStore((state) => state.isHydrated);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const isPermissionsHydrated = usePermissionsStore((state) => state.isHydrated);
  const hasRequiredPermissions = usePermissionsStore((state) => state.hasRequiredPermissions());
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const themePreference = useAppPreferencesStore((state) => state.themePreference);
  const notificationLanguage = useAppPreferencesStore((state) => state.language);
  const navBackground = mapColorForMode('#020617', themeMode);
  const navText = mapColorForMode('#E2E8F0', themeMode);
  const storesReady = (isHydrated && isPermissionsHydrated) || hydrationTimedOut;

  useConnectionHeartbeat();

  const handleUrl = useCallback(
    (url: string): void => {
      const route = resolveDeepLinkRoute(url);
      if (!route) {
        return;
      }
      const connectionParams = route === '/connection' ? extractConnectionRouteParams(url) : null;
      if (!hasRequiredPermissions) {
        if (route === '/connection' && connectionParams) {
          router.replace({
            pathname: '/permissions',
            params: connectionParams,
          });
          return;
        }
        router.replace('/permissions');
        return;
      }
      if (route === '/connection') {
        router.replace(
          connectionParams
            ? {
                pathname: '/connection',
                params: connectionParams,
              }
            : '/connection',
        );
        return;
      }
      if (!activeProfileId) {
        router.replace('/connection');
        return;
      }

      try {
        const parsed = new URL(url);
        const gatewayId = parsed.searchParams.get('gatewayId');
        const agentId = parsed.searchParams.get('agentId');
        const sessionId = parsed.searchParams.get('sessionId');

        if (gatewayId) {
          void useConnectionStore.getState().switchGatewayProfile(gatewayId).catch(() => undefined);
        }
        if (agentId) {
          useChatStore.getState().setActiveAgent(agentId);
        }
        if (sessionId) {
          useChatStore.getState().setActiveSession(sessionId);
          useChatStore.getState().ensureSessionMessagesLoaded(sessionId);
        }
      } catch {
        // Ignore malformed deep-link query params.
      }
      router.replace(route);
    },
    [activeProfileId, hasRequiredPermissions, router],
  );

  useEffect(() => {
    if (isHydrated && isPermissionsHydrated) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHydrationTimedOut(true);
    }, 1500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isHydrated, isPermissionsHydrated]);

  useEffect(() => {
    if (!isPermissionsHydrated) {
      return;
    }

    void refreshPermissions().catch(() => {
      // Keep startup resilient if permission APIs fail temporarily.
    });
  }, [isPermissionsHydrated, refreshPermissions]);

  useEffect(() => {
    if (!storesReady) {
      return;
    }

    const isPermissionScreen = pathname === '/permissions';
    const isConnectionScreen = pathname === '/connection';
    const isSettingsScreen = pathname.startsWith('/settings');

    if (!hasRequiredPermissions) {
      if (!isPermissionScreen && !isConnectionScreen) {
        router.replace('/permissions');
      }
      return;
    }

    if (isPermissionScreen) {
      router.replace(activeProfileId ? '/(tabs)/dashboard' : '/connection');
      return;
    }

    if (!activeProfileId && !isConnectionScreen && !isSettingsScreen) {
      router.replace('/connection');
      return;
    }

  }, [activeProfileId, hasRequiredPermissions, pathname, router, storesReady]);

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : themePreference);
    return () => {
      Appearance.setColorScheme('unspecified');
    };
  }, [themePreference]);

  useEffect(() => {
    if (!storesReady) {
      return;
    }

    void Linking.getInitialURL()
      .then((url) => {
        if (url) {
          handleUrl(url);
        }
      })
      .catch(() => {
        // Ignore initial URL parsing failures.
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl, storesReady]);

  useEffect(() => {
    if (!storesReady) {
      return;
    }

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        return handleAlertNotificationResponse(response, handleUrl);
      })
      .catch(() => undefined);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleAlertNotificationResponse(response, handleUrl);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl, storesReady]);

  useEffect(() => {
    if (!storesReady || !activeProfileId) {
      return;
    }

    let appState: AppStateStatus = AppState.currentState;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refreshSurfaceData = (): void => {
      if (appState !== 'active') {
        return;
      }

      void Promise.allSettled([
        useDashboardStore.getState().refresh(),
        getAgents().then((response) => {
          useAgentsRuntimeStore.getState().hydrateAgents(response.agents);
        }),
        useConnectionStore.getState().pollAllGateways(),
      ]).catch(() => undefined);
    };

    refreshSurfaceData();
    intervalId = setInterval(refreshSurfaceData, SURFACE_REFRESH_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appState !== 'active';
      appState = nextState;
      if (wasBackground && nextState === 'active') {
        refreshSurfaceData();
      }
    });

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      subscription.remove();
    };
  }, [activeProfileId, storesReady]);

  useEffect(() => {
    if (!storesReady || Platform.OS !== 'ios' || !nativeSurfaceBridge?.consumeControlRefreshRequest) {
      return;
    }

    const timer = setInterval(() => {
      void nativeSurfaceBridge
        .consumeControlRefreshRequest?.()
        .then((shouldRefresh) => {
          if (!shouldRefresh) {
            return;
          }

          return useConnectionStore
            .getState()
            .pingActiveGateway()
            .catch(() => undefined)
            .then(() => publishSystemSurfaces(aggregateSystemSnapshot()))
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }, 8000);

    return () => {
      clearInterval(timer);
    };
  }, [storesReady]);

  useEffect(() => {
    if (
      !storesReady ||
      !hasRequiredPermissions ||
      !activeProfileId ||
      Platform.OS !== 'ios' ||
      !nativeSurfaceBridge?.consumePendingShortcutCommand
    ) {
      return;
    }

    const executeShortcutCommand = async (payload: string | null): Promise<void> => {
      if (!payload) {
        return;
      }

      let commands: PendingShortcutCommand[] = [];
      try {
        const parsed = JSON.parse(payload) as PendingShortcutCommand | PendingShortcutCommand[];
        commands = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return;
      }

      for (const command of commands) {
        if (!command?.kind) {
          continue;
        }

        if (command.kind === 'restart_agent') {
          const agentId = command.agentId?.trim();
          if (!agentId) {
            continue;
          }

          router.replace('/(tabs)/agents');
          await restartAgent(agentId)
            .then(async () => {
              const agents = await getAgents();
              useAgentsRuntimeStore.getState().hydrateAgents(agents.agents);
            })
            .catch(() => undefined);
          continue;
        }

        if (command.kind === 'send_message') {
          const agentId = command.agentId?.trim();
          const message = command.message?.trim();
          if (!agentId || !message) {
            continue;
          }

          const chatStore = useChatStore.getState();
          const sessionId = chatStore.createSession(agentId);
          chatStore.setActiveAgent(agentId);
          chatStore.setActiveSession(sessionId);
          chatStore.ensureSessionMessagesLoaded(sessionId);
          router.replace('/(tabs)/chat');
          await chatStore.sendMessage({
            agentId,
            sessionId,
            content: message,
          }).catch(() => undefined);
        }
      }
    };

    let draining = false;

    const tick = (): void => {
      if (draining) {
        return;
      }

      draining = true;
      void nativeSurfaceBridge
        .consumePendingShortcutCommand?.()
        .then((payload) => executeShortcutCommand(payload))
        .catch(() => undefined)
        .finally(() => {
          draining = false;
        });
    };

    tick();
    const timer = setInterval(tick, 1500);

    return () => {
      clearInterval(timer);
    };
  }, [activeProfileId, hasRequiredPermissions, router, storesReady]);

  useEffect(() => {
    if (!storesReady) {
      return;
    }

    void registerAlertNotificationCategories(notificationLanguage).catch(() => undefined);
    void registerForPushAlerts().catch(() => {
      // Fall back to local notifications when remote registration fails.
    });
    void registerBackgroundRefreshTask().catch(() => {
      // Keep startup resilient when background task registration is unavailable.
    });

    const stopLocalAlerts = startLocalAlertsMonitor();
    const stopSpotlightIndexing = startSpotlightIndexing();
    const unsubscribe = subscribeSnapshotChanges((snapshot) => {
      void publishSystemSurfaces(snapshot).catch(() => {
        // Do not let optional system surface updates crash app startup.
      });
    });

    return () => {
      stopLocalAlerts();
      stopSpotlightIndexing();
      unsubscribe();
      void unregisterBackgroundRefreshTask().catch(() => undefined);
    };
  }, [notificationLanguage, storesReady]);

  return (
    <>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: navBackground },
          headerTintColor: navText,
          contentStyle: { backgroundColor: navBackground },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="permissions" options={{ headerShown: false }} />
        <Stack.Screen name="connection" options={{ headerShown: false }} />
        <Stack.Screen name="settings/gateways" options={{ title: t('settings_gateway_list_title') }} />
        <Stack.Screen name="settings/health-bridge" options={{ title: t('settings_health_bridge_title') }} />
      </Stack>
      <DisconnectBanner />
    </>
  );
}

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <RootNavigation />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = createAdaptiveStyles({
  root: {
    flex: 1,
    backgroundColor: '#020617',
  },
  banner: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerTitle: {
    color: '#FECACA',
    fontWeight: '700',
    fontSize: 12,
  },
  bannerText: {
    color: '#FCA5A5',
    fontSize: 11,
  },
  bannerButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bannerButtonText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
});
