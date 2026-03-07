import 'react-native-url-polyfill/auto';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Appearance, Linking, NativeModules, Platform, Pressable, Text, View, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { z } from 'zod';

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
import { isHiddenDebugProfileEnabled, resolveExperimentalFeatureFlags } from '../src/lib/features/featureFlags';
import { getString, removeItem, setString } from '../src/lib/mmkv/storage';
import { initSentry, Sentry } from '../src/lib/monitoring/sentry';
import { authenticateAction } from '../src/lib/security/biometric';
import { HIDDEN_DEBUG_TOKEN } from '../src/features/connection/debugProfile';
import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../src/theme/adaptiveStyles';

type DeepLinkRoute =
  | '/(tabs)/chat'
  | '/(tabs)/monitor'
  | '/(tabs)/agents'
  | '/(tabs)/dashboard'
  | '/(tabs)/inbox'
  | '/connection';

const DEEP_LINK_ROUTE_MAP: Record<string, DeepLinkRoute> = {
  chat: '/(tabs)/chat',
  monitor: '/(tabs)/monitor',
  agents: '/(tabs)/agents',
  dashboard: '/(tabs)/dashboard',
  inbox: '/(tabs)/inbox',
  incidents: '/(tabs)/inbox',
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
  id: string;
  kind: 'restart_agent' | 'send_message';
  agentId?: string | null;
  message?: string | null;
  createdAt: number;
}

interface ShortcutBacklogEntry extends PendingShortcutCommand {
  attemptCount: number;
  nextAttemptAt: number;
}

const SHORTCUT_BACKLOG_STORAGE_KEY = 'shortcut-intents:backlog:v1';
const SHORTCUT_AUTH_RETRY_DELAY_MS = 60_000;
const SHORTCUT_FAILURE_BASE_DELAY_MS = 15_000;
const SHORTCUT_FAILURE_MAX_DELAY_MS = 5 * 60_000;
const PROMO_DEMO_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_PROMO_DEMO === '1';
const HIDDEN_DEBUG_PROFILE_ENABLED = isHiddenDebugProfileEnabled();

initSentry();

const PendingShortcutCommandSchema = z.object({
  id: z.string().trim().min(1).optional(),
  kind: z.enum(['restart_agent', 'send_message']),
  agentId: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  createdAt: z.number().finite().optional(),
});

const PendingShortcutCommandPayloadSchema = z
  .union([PendingShortcutCommandSchema, z.array(PendingShortcutCommandSchema)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

const ShortcutBacklogEntrySchema = PendingShortcutCommandSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.number().finite(),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.number().finite(),
});

const ShortcutBacklogSchema = z.array(ShortcutBacklogEntrySchema);

function normalizeShortcutCommandId(command: z.infer<typeof PendingShortcutCommandSchema>): string {
  if (command.id?.trim()) {
    return command.id.trim();
  }

  const createdAt = typeof command.createdAt === 'number' && Number.isFinite(command.createdAt) ? command.createdAt : 0;
  return [
    command.kind,
    command.agentId?.trim() ?? '',
    command.message?.trim() ?? '',
    createdAt,
  ].join(':');
}

function normalizePendingShortcutCommand(
  command: z.infer<typeof PendingShortcutCommandSchema>,
): PendingShortcutCommand {
  return {
    id: normalizeShortcutCommandId(command),
    kind: command.kind,
    agentId: command.agentId?.trim() || null,
    message: command.message?.trim() || null,
    createdAt: typeof command.createdAt === 'number' && Number.isFinite(command.createdAt) ? command.createdAt : Date.now(),
  };
}

function readShortcutBacklog(): ShortcutBacklogEntry[] {
  const raw = getString(SHORTCUT_BACKLOG_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return ShortcutBacklogSchema.parse(JSON.parse(raw));
  } catch {
    removeItem(SHORTCUT_BACKLOG_STORAGE_KEY);
    return [];
  }
}

function persistShortcutBacklog(backlog: ShortcutBacklogEntry[]): void {
  if (backlog.length === 0) {
    removeItem(SHORTCUT_BACKLOG_STORAGE_KEY);
    return;
  }

  setString(SHORTCUT_BACKLOG_STORAGE_KEY, JSON.stringify(backlog));
}

function mergeShortcutBacklog(
  backlog: ShortcutBacklogEntry[],
  commands: PendingShortcutCommand[],
): ShortcutBacklogEntry[] {
  if (commands.length === 0) {
    return backlog;
  }

  const seen = new Set(backlog.map((entry) => entry.id));
  const merged = [...backlog];

  for (const command of commands) {
    if (seen.has(command.id)) {
      continue;
    }

    seen.add(command.id);
    merged.push({
      ...command,
      attemptCount: 0,
      nextAttemptAt: 0,
    });
  }

  return merged.sort((a, b) => a.createdAt - b.createdAt);
}

function parseShortcutCommandPayload(payload: string): PendingShortcutCommand[] {
  const parsed = PendingShortcutCommandPayloadSchema.parse(JSON.parse(payload));
  return parsed.map((command) => normalizePendingShortcutCommand(command));
}

function nextShortcutRetryAt(attemptCount: number, delayMs?: number): number {
  if (typeof delayMs === 'number' && delayMs > 0) {
    return Date.now() + delayMs;
  }

  return Date.now() + Math.min(SHORTCUT_FAILURE_MAX_DELAY_MS, SHORTCUT_FAILURE_BASE_DELAY_MS * 2 ** attemptCount);
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
  const connectAndSaveProfile = useConnectionStore((state) => state.connectAndSaveProfile);
  const isPermissionsHydrated = usePermissionsStore((state) => state.isHydrated);
  const hasRequiredPermissions = usePermissionsStore((state) => state.hasRequiredPermissions());
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const themePreference = useAppPreferencesStore((state) => state.themePreference);
  const notificationLanguage = useAppPreferencesStore((state) => state.language);
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const navBackground = mapColorForMode('#020617', themeMode);
  const navText = mapColorForMode('#E2E8F0', themeMode);
  const storesReady = (isHydrated && isPermissionsHydrated) || hydrationTimedOut;
  const promoBootstrapStartedRef = useRef(false);
  const experimentalFeatures = useMemo(
    () => resolveExperimentalFeatureFlags(featureOverrides),
    [featureOverrides],
  );

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
      router.replace(route as Parameters<typeof router.replace>[0]);
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
    if (!PROMO_DEMO_ENABLED || !HIDDEN_DEBUG_PROFILE_ENABLED || !storesReady || promoBootstrapStartedRef.current) {
      return;
    }

    promoBootstrapStartedRef.current = true;
    usePermissionsStore.setState({
      permissions: {
        camera: 'granted',
        photos: 'granted',
        microphone: 'granted',
        localNetwork: 'granted',
      },
    });
    useAppPreferencesStore.setState({
      language: 'zh',
      themePreference: 'dark',
    });

    void connectAndSaveProfile({
      host: '127.0.0.1',
      port: 18789,
      token: HIDDEN_DEBUG_TOKEN,
      tls: false,
      name: 'Promo Demo Gateway',
    })
      .then(() => {
        router.replace('/(tabs)/dashboard');
      })
      .catch(() => {
        promoBootstrapStartedRef.current = false;
      });
  }, [connectAndSaveProfile, router, storesReady]);

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
      !experimentalFeatures.shortcutIntents ||
      Platform.OS !== 'ios' ||
      !nativeSurfaceBridge?.consumePendingShortcutCommand
    ) {
      return;
    }

    const executeShortcutCommand = async (
      command: ShortcutBacklogEntry,
    ): Promise<{ status: 'success' | 'retry' | 'drop'; retryDelayMs?: number }> => {
      if (command.kind === 'restart_agent') {
        const agentId = command.agentId?.trim();
        if (!agentId) {
          return { status: 'drop' };
        }

        const allowed = await authenticateAction('Restart agent process?');
        if (!allowed) {
          return {
            status: 'retry',
            retryDelayMs: SHORTCUT_AUTH_RETRY_DELAY_MS,
          };
        }

        router.replace('/(tabs)/agents');
        try {
          await restartAgent(agentId);
          await getAgents()
            .then((response) => {
              useAgentsRuntimeStore.getState().hydrateAgents(response.agents);
            })
            .catch(() => undefined);
          return { status: 'success' };
        } catch {
          return { status: 'retry' };
        }
      }

      const agentId = command.agentId?.trim();
      const message = command.message?.trim();
      if (!agentId || !message) {
        return { status: 'drop' };
      }

      const chatStore = useChatStore.getState();
      const sessionId = chatStore.createSession(agentId);
      chatStore.setActiveAgent(agentId);
      chatStore.setActiveSession(sessionId);
      chatStore.ensureSessionMessagesLoaded(sessionId);
      router.replace('/(tabs)/chat');
      try {
        await chatStore.sendMessage({
          agentId,
          sessionId,
          content: message,
        });
        return { status: 'success' };
      } catch {
        return { status: 'retry' };
      }
    };

    let draining = false;

    const tick = (): void => {
      if (draining) {
        return;
      }

      draining = true;
      void (async () => {
        let backlog = readShortcutBacklog();

        try {
          const payload = await nativeSurfaceBridge.consumePendingShortcutCommand?.();
          if (payload) {
            const commands = parseShortcutCommandPayload(payload);
            backlog = mergeShortcutBacklog(backlog, commands);
            persistShortcutBacklog(backlog);
          }
        } catch {
          // Keep existing backlog for later retry.
        }

        const now = Date.now();
        const nextIndex = backlog.findIndex((entry) => entry.nextAttemptAt <= now);
        if (nextIndex === -1) {
          return;
        }

        const entry = backlog[nextIndex];
        const result = await executeShortcutCommand(entry);

        if (result.status === 'success' || result.status === 'drop') {
          backlog.splice(nextIndex, 1);
          persistShortcutBacklog(backlog);
          return;
        }

        backlog[nextIndex] = {
          ...entry,
          attemptCount: entry.attemptCount + 1,
          nextAttemptAt: nextShortcutRetryAt(entry.attemptCount, result.retryDelayMs),
        };
        persistShortcutBacklog(backlog);
      })()
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
  }, [activeProfileId, experimentalFeatures.shortcutIntents, hasRequiredPermissions, router, storesReady]);

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
        <Stack.Screen
          name="settings/index"
          options={{
            title: t('tabs_settings'),
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
        <Stack.Screen
          name="settings/gateways"
          options={{
            title: t('settings_gateway_list_title'),
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
        <Stack.Screen
          name="settings/health-bridge"
          options={{
            title: t('settings_health_bridge_title'),
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
      </Stack>
      <DisconnectBanner />
    </>
  );
}

function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <RootNavigation />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);

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
