import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Modal,
  InteractionManager,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { getSessionMessages } from '../../../lib/api';
import { adaptiveColor, createAdaptiveStyles, mapColorForMode, useThemeMode } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { getVisibleGatewayProfiles } from '../../connection/debugProfile';
import { useI18n } from '../../../lib/i18n';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import { useDashboardStore } from '../store/dashboardStore';
import type { DashboardRefreshInterval } from '../types';
import { RequestVolumeChart } from '../components/RequestVolumeChart';
import { CostHistoryChart } from '../components/CostHistoryChart';
import type { DashboardSectionKey } from '../../settings/store/preferencesStore';

const REFRESH_OPTIONS: DashboardRefreshInterval[] = [0, 30, 60, 300];
const DASHBOARD_SECTIONS: DashboardSectionKey[] = [
  'volume',
  'tokenModels',
  'latency',
  'usage',
  'channels',
  'sessions',
];

function formatRefreshLabel(
  interval: DashboardRefreshInterval,
  labels: { manual: string; fiveMin: string },
): string {
  if (interval === 0) {
    return labels.manual;
  }
  if (interval === 300) {
    return labels.fiveMin;
  }
  return `${interval}s`;
}

function formatNumber(value: number): string {
  return Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function trendArrow(direction: 'up' | 'down' | 'flat', language: 'zh' | 'en'): string {
  if (language === 'zh') {
    if (direction === 'up') {
      return '上升';
    }
    if (direction === 'down') {
      return '下降';
    }
    return '持平';
  }

  if (direction === 'up') {
    return 'UP';
  }
  if (direction === 'down') {
    return 'DOWN';
  }
  return 'FLAT';
}

function channelStatusColor(status: 'healthy' | 'degraded' | 'offline' | 'unknown', mode: 'light' | 'dark'): string {
  switch (status) {
    case 'healthy':
      return mapColorForMode('#22C55E', mode);
    case 'degraded':
      return mapColorForMode('#F59E0B', mode);
    case 'offline':
      return mapColorForMode('#EF4444', mode);
    default:
      return mapColorForMode('#94A3B8', mode);
  }
}

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map((item) => Number.parseInt(item, 10));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 127
  );
}

function resolveGatewayScope(host: string): 'local' | 'vps' {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    isPrivateIpv4(normalized)
  ) {
    return 'local';
  }

  return 'vps';
}

function ChartLoadingState(props: { label: string }): JSX.Element {
  return (
    <View style={styles.chartLoading}>
      <ActivityIndicator color={adaptiveColor('#38BDF8')} />
      <Text style={styles.chartLoadingText}>{props.label}</Text>
    </View>
  );
}

export function DashboardScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const { t, language } = useI18n();
  const connectionStatus = useConnectionStore((state) => state.connectionStatus);
  const backgroundHealthStatus = useConnectionStore((state) => state.backgroundHealthStatus);
  const allProfiles = useConnectionStore((state) => state.profiles);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const lastHealthCheckAt = useConnectionStore((state) => state.lastHealthCheckAt);
  const tokenExpiresAt = useConnectionStore((state) => state.tokenExpiresAt);
  const tokenExpiringSoon = useConnectionStore((state) => state.tokenExpiringSoon);
  const tokenRefreshAvailable = useConnectionStore((state) => state.tokenRefreshAvailable);
  const switchGatewayProfile = useConnectionStore((state) => state.switchGatewayProfile);
  const dashboardSectionOrder = useAppPreferencesStore((state) => state.dashboardSectionOrder);

  const { snapshot, costHistory, costHistorySource, refreshInterval, setRefreshInterval, refresh, lastError } = useDashboardStore(
    useShallow((state) => ({
      snapshot: state.snapshot,
      costHistory: state.costHistory,
      costHistorySource: state.costHistorySource,
      refreshInterval: state.refreshInterval,
      setRefreshInterval: state.setRefreshInterval,
      refresh: state.refresh,
      lastError: state.lastError,
    })),
  );

  const [isFocused, setIsFocused] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [switchingGatewayId, setSwitchingGatewayId] = useState<string | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<
    Array<{ id: string; role: string; content: string; createdAt: string }>
  >([]);
  const [sessionMessagesLoading, setSessionMessagesLoading] = useState(false);
  const [sessionMessagesError, setSessionMessagesError] = useState<string | null>(null);
  const [costWindowDays, setCostWindowDays] = useState<7 | 30>(7);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const profiles = useMemo(() => getVisibleGatewayProfiles(allProfiles), [allProfiles]);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      void refresh();

      return () => {
        setIsFocused(false);
      };
    }, [refresh]),
  );

  useEffect(() => {
    if (!isFocused || chartsReady) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      setChartsReady(true);
    });

    return () => {
      task.cancel();
    };
  }, [chartsReady, isFocused]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current !== 'active';
      appStateRef.current = nextState;

      if (wasBackground && nextState === 'active' && isFocused) {
        void refresh();
      }
    });

    return () => {
      sub.remove();
    };
  }, [isFocused, refresh]);

  useEffect(() => {
    if (!isFocused || refreshInterval === 0) {
      return;
    }

    const timer = setInterval(() => {
      if (appStateRef.current === 'active') {
        void refresh();
      }
    }, refreshInterval * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isFocused, refresh, refreshInterval]);

  const statusPill = useMemo(
    () =>
      connectionStatus === 'connected'
        ? { text: t('dashboard_status_online'), color: mapColorForMode('#10B981', themeMode) }
        : { text: t('dashboard_status_offline'), color: mapColorForMode('#EF4444', themeMode) },
    [connectionStatus, t, themeMode],
  );

  const latencyAccent = useMemo(() => mapColorForMode('#2563EB', themeMode), [themeMode]);
  const channels = snapshot.channels ?? [];
  const sessions = snapshot.sessions ?? [];
  const usageProviders = snapshot.usageProviders ?? [];
  const costTrendPoints = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: costWindowDays }, (_, index) => {
      const offset = costWindowDays - 1 - index;
      const dayTimestamp = now - offset * 24 * 60 * 60 * 1000;
      const key = toLocalDateKey(dayTimestamp);
      const item = costHistory[key];
      return {
        date: key,
        cost: item?.cost ?? 0,
        tokens: item?.tokens ?? 0,
        requests: item?.requests ?? 0,
      };
    });
  }, [costHistory, costWindowDays]);
  const totalWindowCost = useMemo(
    () => costTrendPoints.reduce((sum, item) => sum + item.cost, 0),
    [costTrendPoints],
  );
  const totalWindowTokens = useMemo(
    () => costTrendPoints.reduce((sum, item) => sum + item.tokens, 0),
    [costTrendPoints],
  );
  const totalWindowRequests = useMemo(
    () => costTrendPoints.reduce((sum, item) => sum + item.requests, 0),
    [costTrendPoints],
  );

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const orderedSections = useMemo(() => {
    const source = dashboardSectionOrder.length > 0 ? dashboardSectionOrder : DASHBOARD_SECTIONS;
    const deduped = source.filter((item, index) => source.indexOf(item) === index);
    const filtered = deduped.filter((item): item is DashboardSectionKey => DASHBOARD_SECTIONS.includes(item));
    const missing = DASHBOARD_SECTIONS.filter((item) => !filtered.includes(item));
    return [...filtered, ...missing];
  }, [dashboardSectionOrder]);

  const activeProfile = useMemo(
    () => profiles.find((item) => item.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  const gatewayScope = useMemo(
    () => (activeProfile ? resolveGatewayScope(activeProfile.host) : 'local'),
    [activeProfile],
  );

  const healthState = useMemo(() => {
    if (connectionStatus === 'connected') {
      return {
        tone: 'healthy' as const,
        label: t('dashboard_health_healthy'),
        body: t('dashboard_health_healthy_body'),
      };
    }
    if (connectionStatus === 'connecting') {
      return {
        tone: 'degraded' as const,
        label: t('dashboard_health_reconnecting'),
        body: t('dashboard_health_reconnecting_body'),
      };
    }
    return {
      tone: 'offline' as const,
      label: t('dashboard_health_offline'),
      body: t('dashboard_health_offline_body'),
    };
  }, [connectionStatus, t]);

  const globalGatewayItems = useMemo(() => {
    return profiles.map((profile) => {
      const isActive = profile.id === activeProfileId;
      const background = backgroundHealthStatus[profile.id];
      const status = isActive ? connectionStatus : background?.status ?? 'disconnected';
      const lastCheck = isActive ? lastHealthCheckAt ?? 0 : background?.lastCheck ?? 0;
      const lastError = !isActive ? background?.lastError ?? null : null;
      const tone =
        status === 'connected'
          ? mapColorForMode('#10B981', themeMode)
          : status === 'connecting'
            ? mapColorForMode('#F59E0B', themeMode)
            : mapColorForMode('#EF4444', themeMode);
      const label =
        status === 'connected'
          ? t('dashboard_status_online')
          : status === 'connecting'
            ? t('dashboard_health_reconnecting')
            : t('dashboard_status_offline');

      return {
        id: profile.id,
        name: profile.name,
        isActive,
        label,
        tone,
        lastCheck,
        lastError,
      };
    });
  }, [activeProfileId, backgroundHealthStatus, connectionStatus, lastHealthCheckAt, profiles, t, themeMode]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionMessages([]);
      setSessionMessagesError(null);
      return;
    }

    let canceled = false;
    setSessionMessagesLoading(true);
    setSessionMessagesError(null);

    void getSessionMessages(selectedSessionId)
      .then((response) => {
        if (canceled) {
          return;
        }

        setSessionMessages(
          response.messages.map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            createdAt: item.createdAt,
          })),
        );
      })
      .catch((error: unknown) => {
        if (canceled) {
          return;
        }
        setSessionMessages([]);
        setSessionMessagesError(error instanceof Error ? error.message : t('dashboard_modal_load_messages_failed'));
      })
      .finally(() => {
        if (!canceled) {
          setSessionMessagesLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [selectedSessionId, t]);

  const handleManualRefresh = useCallback(async (): Promise<void> => {
    setManualRefreshing(true);
    try {
      await refresh();
    } finally {
      setManualRefreshing(false);
    }
  }, [refresh]);

  const handleSwitchGateway = useCallback(
    async (profileId: string): Promise<void> => {
      if (profileId === activeProfileId || switchingGatewayId) {
        return;
      }

      setSwitchingGatewayId(profileId);
      try {
        await switchGatewayProfile(profileId);
        await refresh();
      } catch (error: unknown) {
        Alert.alert(
          t('dashboard_gateway_switch_failed_title'),
          error instanceof Error ? error.message : t('dashboard_gateway_switch_failed_body'),
        );
      } finally {
        setSwitchingGatewayId(null);
      }
    },
    [activeProfileId, refresh, switchGatewayProfile, switchingGatewayId, t],
  );

  const renderSectionPanel = (section: DashboardSectionKey): JSX.Element => {
    switch (section) {
      case 'volume':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_volume')}</Text>
            {chartsReady ? (
              <RequestVolumeChart data={snapshot.requestVolume24h} themeMode={themeMode} />
            ) : (
              <ChartLoadingState label={t('dashboard_loading_chart')} />
            )}
          </View>
        );
      case 'tokenModels':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_token_by_model')}</Text>
            {!chartsReady ? (
              <ChartLoadingState label={t('dashboard_loading_chart')} />
            ) : snapshot.tokenUsageByModel.length === 0 ? (
              <View style={styles.detailList}>
                <Text style={styles.detailMuted}>{t('dashboard_no_usage_data')}</Text>
              </View>
            ) : (
              <View style={styles.detailList}>
                {snapshot.tokenUsageByModel.map((item) => {
                  const percent = Math.round((item.tokens / Math.max(snapshot.cards.tokenUsageToday, 1)) * 100);
                  const fill = `${Math.max(0, Math.min(100, percent))}%` as `${number}%`;
                  return (
                    <View key={item.model} style={styles.usageCard}>
                      <View style={styles.usageHeader}>
                        <Text style={styles.usageName}>{item.model}</Text>
                        <Text style={styles.usageMeta}>
                          {Intl.NumberFormat('en-US').format(item.tokens)} ({percent}%)
                        </Text>
                      </View>
                      <View style={styles.usageTrack}>
                        <View
                          style={[
                            styles.usageFill,
                            {
                              width: fill,
                              backgroundColor: mapColorForMode(item.color, themeMode),
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      case 'latency':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_latency')}</Text>
            <View style={styles.detailList}>
              {snapshot.latency.map((item) => {
                const value = Math.max(0, item.value);
                const width = `${Math.min(100, Math.round((value / Math.max(snapshot.latency[2]?.value || 1, 1)) * 100))}%` as `${number}%`;
                return (
                  <View key={item.percentile} style={styles.latencyRow}>
                    <View style={styles.usageHeader}>
                      <Text style={styles.usageName}>{item.percentile.toUpperCase()}</Text>
                      <Text style={styles.usageMeta}>{value.toFixed(0)} ms</Text>
                    </View>
                    <View style={styles.usageTrack}>
                      <View style={[styles.usageFill, { width, backgroundColor: latencyAccent }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      case 'usage':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_usage')}</Text>
            <View style={styles.detailList}>
              {usageProviders.length === 0 ? (
                <Text style={styles.detailMuted}>{t('dashboard_no_usage_data')}</Text>
              ) : (
                usageProviders.map((provider) => {
                  const remaining = provider.remainingPercent ?? null;
                  const progress = remaining === null ? 0 : Math.max(0, Math.min(100, remaining));
                  return (
                    <View key={provider.id} style={styles.usageCard}>
                      <View style={styles.usageHeader}>
                        <Text style={styles.usageName}>{provider.name}</Text>
                        <Text style={styles.usageMeta}>
                          {remaining === null ? t('dashboard_na') : `${Math.round(remaining)}% ${t('dashboard_left_suffix')}`}
                        </Text>
                      </View>
                      {!!provider.plan && <Text style={styles.detailMeta}>{provider.plan}</Text>}
                      <View style={styles.usageTrack}>
                        <View style={[styles.usageFill, { width: `${progress}%` }]} />
                      </View>
                      <Text style={styles.detailMeta}>
                        {provider.period ?? t('dashboard_usage_window')}{' '}
                        {provider.resetAt ? `· ${t('dashboard_usage_reset_prefix')} ${new Date(provider.resetAt).toLocaleString()}` : ''}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        );
      case 'channels':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_channels')}</Text>
            <View style={styles.detailList}>
              {channels.length === 0 ? (
                <Text style={styles.detailMuted}>{t('dashboard_no_channel_data')}</Text>
              ) : (
                channels.map((channel) => (
                  <Pressable
                    key={channel.id}
                    style={styles.detailItem}
                    onPress={() => {
                      setSelectedChannelId(channel.id);
                    }}
                  >
                    <View style={styles.detailMain}>
                      <View style={[styles.detailDot, { backgroundColor: channelStatusColor(channel.status, themeMode) }]} />
                      <Text style={styles.detailTitle}>{channel.name}</Text>
                    </View>
                    <Text style={styles.detailMeta}>
                      {channel.sessionCount} sessions · {channel.status}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        );
      case 'sessions':
        return (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('dashboard_title_sessions')}</Text>
            <View style={styles.detailList}>
              {sessions.length === 0 ? (
                <Text style={styles.detailMuted}>{t('dashboard_no_session_data')}</Text>
              ) : (
                sessions.map((session) => (
                  <Pressable
                    key={session.id}
                    style={styles.detailItem}
                    onPress={() => {
                      setSelectedSessionId(session.id);
                    }}
                  >
                    <View style={styles.detailMain}>
                      <Text style={styles.detailTitle} numberOfLines={1}>
                        {session.title}
                      </Text>
                    </View>
                    <Text style={styles.detailMeta} numberOfLines={1}>
                      {session.messageCount} msgs · ctx {session.contextCount}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        );
      default:
        return <View />;
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 116, 132) }]}
      refreshControl={
        <RefreshControl tintColor={adaptiveColor('#38BDF8')} refreshing={manualRefreshing} onRefresh={() => void handleManualRefresh()} />
      }
    >
      <View
        style={[
          styles.healthBanner,
          healthState.tone === 'healthy'
            ? styles.healthBannerHealthy
            : healthState.tone === 'degraded'
              ? styles.healthBannerDegraded
              : styles.healthBannerOffline,
        ]}
      >
        <View
          style={[
            styles.healthDot,
            healthState.tone === 'healthy'
              ? styles.healthDotHealthy
              : healthState.tone === 'degraded'
                ? styles.healthDotDegraded
                : styles.healthDotOffline,
          ]}
        />
        <View style={styles.healthTextWrap}>
          <Text style={styles.healthTitle}>{healthState.label}</Text>
          <Text style={styles.healthBody}>
            {healthState.body}
            {lastHealthCheckAt ? ` · ${new Date(lastHealthCheckAt).toLocaleTimeString()}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.globalGatewayPanel}>
        <Text style={styles.panelTitle}>{t('dashboard_global_gateway_title')}</Text>
        {globalGatewayItems.length === 0 ? (
          <Text style={styles.detailMuted}>{t('dashboard_global_gateway_empty')}</Text>
        ) : (
          <View style={styles.globalGatewayList}>
            {globalGatewayItems.map((item) => (
              <View key={item.id} style={styles.globalGatewayItem}>
                <View style={styles.globalGatewayMain}>
                  <View style={[styles.globalGatewayDot, { backgroundColor: item.tone }]} />
                  <View style={styles.globalGatewayTextWrap}>
                    <Text style={styles.globalGatewayName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.globalGatewayMeta} numberOfLines={1}>
                      {item.label}
                      {item.isActive ? ` · ${t('settings_gateway_profiles_active')}` : ''}
                      {item.lastCheck > 0 ? ` · ${new Date(item.lastCheck).toLocaleTimeString()}` : ''}
                    </Text>
                    {!!item.lastError && <Text style={styles.globalGatewayError} numberOfLines={1}>{item.lastError}</Text>}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {tokenExpiringSoon && tokenExpiresAt && (
        <View style={styles.tokenWarningBanner}>
          <Text style={styles.tokenWarningTitle}>{t('dashboard_token_expiry_title')}</Text>
          <Text style={styles.tokenWarningBody}>
            {t('dashboard_token_expiry_body')} {new Date(tokenExpiresAt).toLocaleString()}
            {tokenRefreshAvailable === false ? ` · ${t('dashboard_token_refresh_unavailable')}` : ''}
          </Text>
        </View>
      )}

      <View style={styles.gatewayPanel}>
        <View style={styles.gatewayHeader}>
          <Text style={styles.gatewayTitle}>{t('dashboard_gateway_panel_title')}</Text>
          <Pressable
            style={styles.gatewayManageButton}
            onPress={() => {
              router.push('/settings/gateways');
            }}
          >
            <Text style={styles.gatewayManageText}>{t('dashboard_gateway_manage')}</Text>
          </Pressable>
        </View>

        {activeProfile ? (
          <>
            <Text style={styles.gatewayName} numberOfLines={1}>
              {activeProfile.name}
            </Text>
            <Text style={styles.gatewayAddress} numberOfLines={1}>
              {`${activeProfile.tls ? 'https' : 'http'}://${activeProfile.host}:${activeProfile.port}`}
            </Text>
            <Text style={styles.gatewayMeta}>
              {t('dashboard_gateway_scope_prefix')} {gatewayScope === 'local' ? t('dashboard_gateway_scope_local') : t('dashboard_gateway_scope_vps')}
              {' · '}
              {t('dashboard_gateway_saved_prefix')} {profiles.length}
            </Text>
          </>
        ) : (
          <Text style={styles.gatewayMeta}>{t('dashboard_gateway_empty')}</Text>
        )}

        {profiles.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gatewayChips}>
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const switching = profile.id === switchingGatewayId;
              return (
                <Pressable
                  key={profile.id}
                  style={[styles.gatewayChip, active && styles.gatewayChipActive]}
                  disabled={active || !!switchingGatewayId}
                  onPress={() => {
                    void handleSwitchGateway(profile.id);
                  }}
                >
                  {switching ? (
                    <ActivityIndicator color={mapColorForMode('#E2E8F0', themeMode)} size="small" />
                  ) : (
                    <Text style={[styles.gatewayChipText, active && styles.gatewayChipTextActive]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.cardsScroller}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsRow}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard_title_status')}</Text>
            <View style={[styles.statusPill, { backgroundColor: `${statusPill.color}22` }]}>
              <View style={[styles.statusDot, { backgroundColor: statusPill.color }]} />
              <Text style={[styles.statusText, { color: statusPill.color }]}>{statusPill.text}</Text>
            </View>
            <Text style={styles.cardValue}>{snapshot.cards.uptimeLabel}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard_title_requests')}</Text>
            <Text style={styles.cardValue}>{formatNumber(snapshot.cards.requestsToday)}</Text>
            <Text style={styles.cardHint}>
              {trendArrow(snapshot.cards.requestsTrend.direction, language)} {snapshot.cards.requestsTrend.percentage}%
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard_title_tokens')}</Text>
            <Text style={styles.cardValue}>{formatNumber(snapshot.cards.tokenUsageToday)}</Text>
            <Text style={styles.cardHint}>{t('dashboard_tokens_today_hint')}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard_title_cost')}</Text>
            <Text style={styles.cardValue}>{formatCurrency(snapshot.cards.estimatedCostToday)}</Text>
            <Text style={styles.cardHint}>{t('dashboard_pricing_hint')}</Text>
          </View>
        </ScrollView>
      </View>

      <View style={styles.panel}>
        <View style={styles.costHeaderRow}>
          <View>
            <Text style={styles.panelTitle}>{t('dashboard_cost_history_title')}</Text>
            <Text style={styles.sectionHint}>
              {costHistorySource === 'gateway'
                ? t('dashboard_cost_history_source_gateway')
                : t('dashboard_cost_history_source_local')}
            </Text>
          </View>
          <View style={styles.costWindowRow}>
            {[7, 30].map((windowDay) => {
              const selected = costWindowDays === windowDay;
              return (
                <Pressable
                  key={windowDay}
                  style={[styles.costWindowChip, selected && styles.costWindowChipSelected]}
                  onPress={() => {
                    setCostWindowDays(windowDay as 7 | 30);
                  }}
                >
                  <Text style={[styles.costWindowChipText, selected && styles.costWindowChipTextSelected]}>
                    {windowDay}D
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <CostHistoryChart points={costTrendPoints} themeMode={themeMode} />
        <View style={styles.costSummaryRow}>
          <Text style={styles.detailMeta}>{formatCurrency(totalWindowCost)}</Text>
          <Text style={styles.detailMeta}>{formatNumber(totalWindowTokens)} tokens</Text>
          <Text style={styles.detailMeta}>{formatNumber(totalWindowRequests)} req</Text>
        </View>
      </View>

      {!!lastError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>{t('dashboard_refresh_failed')}</Text>
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      )}

      {orderedSections.map((section) => (
        <View key={section}>{renderSectionPanel(section)}</View>
      ))}

      <View style={styles.intervalRow}>
        {REFRESH_OPTIONS.map((interval) => {
          const selected = interval === refreshInterval;
          return (
            <Pressable
              key={interval}
              style={[styles.intervalChip, selected && styles.intervalChipSelected]}
              onPress={() => {
                setRefreshInterval(interval);
              }}
            >
              <Text style={[styles.intervalChipText, selected && styles.intervalChipTextSelected]}>
                {formatRefreshLabel(interval, {
                  manual: t('dashboard_refresh_manual'),
                  fiveMin: t('dashboard_refresh_5min'),
                })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.footerMeta}>
        {t('dashboard_last_updated')}: {new Date(snapshot.fetchedAt).toLocaleTimeString()}
      </Text>

      <Modal visible={!!selectedChannel} transparent animationType="fade" onRequestClose={() => setSelectedChannelId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('dashboard_channel_detail_title')}</Text>
            {selectedChannel && (
              <>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_id')}: {selectedChannel.id}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_name')}: {selectedChannel.name}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_status')}: {selectedChannel.status}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_sessions')}: {selectedChannel.sessionCount}</Text>
                {!!selectedChannel.lastEventAt && (
                  <Text style={styles.modalLine}>
                    {t('dashboard_modal_field_last_event')}: {new Date(selectedChannel.lastEventAt).toLocaleString()}
                  </Text>
                )}
                {!!selectedChannel.description && (
                  <Text style={styles.modalLine}>{t('dashboard_modal_field_description')}: {selectedChannel.description}</Text>
                )}
              </>
            )}
            <Pressable style={styles.modalButton} onPress={() => setSelectedChannelId(null)}>
              <Text style={styles.modalButtonText}>{t('dashboard_modal_close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedSession} transparent animationType="fade" onRequestClose={() => setSelectedSessionId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardLarge}>
            <Text style={styles.modalTitle}>{t('dashboard_session_detail_title')}</Text>
            {selectedSession && (
              <>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_id')}: {selectedSession.id}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_title')}: {selectedSession.title}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_messages')}: {selectedSession.messageCount}</Text>
                <Text style={styles.modalLine}>{t('dashboard_modal_field_context')}: {selectedSession.contextCount}</Text>
                {!!selectedSession.channelId && <Text style={styles.modalLine}>{t('dashboard_modal_field_channel')}: {selectedSession.channelId}</Text>}
                {!!selectedSession.agentId && <Text style={styles.modalLine}>{t('dashboard_modal_field_agent')}: {selectedSession.agentId}</Text>}
                {!!selectedSession.model && <Text style={styles.modalLine}>{t('dashboard_modal_field_model')}: {selectedSession.model}</Text>}
                {!!selectedSession.updatedAt && (
                  <Text style={styles.modalLine}>
                    {t('dashboard_modal_field_updated')}: {new Date(selectedSession.updatedAt).toLocaleString()}
                  </Text>
                )}
              </>
            )}

            <Text style={styles.modalSubTitle}>{t('dashboard_modal_recent_messages')}</Text>
            {sessionMessagesLoading ? (
              <ActivityIndicator color={adaptiveColor('#38BDF8')} />
            ) : sessionMessagesError ? (
              <Text style={styles.detailMuted}>{sessionMessagesError}</Text>
            ) : sessionMessages.length === 0 ? (
              <Text style={styles.detailMuted}>{t('dashboard_no_messages')}</Text>
            ) : (
              <ScrollView style={styles.modalMessagesList} contentContainerStyle={styles.modalMessagesContent}>
                {sessionMessages.map((message) => (
                  <View key={message.id} style={styles.modalMessageItem}>
                    <Text style={styles.modalMessageHeader}>
                      {message.role.toUpperCase()} · {new Date(message.createdAt).toLocaleTimeString()}
                    </Text>
                    <Text style={styles.modalMessageContent}>{message.content}</Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable style={styles.modalButton} onPress={() => setSelectedSessionId(null)}>
              <Text style={styles.modalButtonText}>{t('dashboard_modal_close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = createAdaptiveStyles({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    paddingVertical: 18,
    paddingBottom: 32,
    gap: 16,
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  healthBanner: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  healthBannerHealthy: {
    borderColor: '#14532D',
    backgroundColor: '#0F2D1D',
  },
  healthBannerDegraded: {
    borderColor: '#78350F',
    backgroundColor: '#2B1B0E',
  },
  healthBannerOffline: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
  },
  healthDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  healthDotHealthy: {
    backgroundColor: '#22C55E',
  },
  healthDotDegraded: {
    backgroundColor: '#F59E0B',
  },
  healthDotOffline: {
    backgroundColor: '#EF4444',
  },
  tokenWarningBanner: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A16207',
    backgroundColor: '#2B1B0E',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  tokenWarningTitle: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '700',
  },
  tokenWarningBody: {
    color: '#FDE68A',
    fontSize: 11,
    lineHeight: 16,
  },
  healthTextWrap: {
    flex: 1,
    gap: 2,
  },
  healthTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  healthBody: {
    color: '#CBD5E1',
    fontSize: 11,
  },
  gatewayPanel: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0B1220',
    padding: 12,
    gap: 6,
  },
  globalGatewayPanel: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0B1220',
    padding: 12,
    gap: 10,
  },
  globalGatewayList: {
    gap: 10,
  },
  globalGatewayItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  globalGatewayMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  globalGatewayDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  globalGatewayTextWrap: {
    flex: 1,
    gap: 2,
  },
  globalGatewayName: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  globalGatewayMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  globalGatewayError: {
    color: '#FCA5A5',
    fontSize: 11,
  },
  gatewayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  gatewayTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  gatewayManageButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    minHeight: 30,
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  gatewayManageText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  gatewayName: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
  gatewayAddress: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
  },
  gatewayMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  gatewayChips: {
    gap: 8,
    paddingTop: 4,
  },
  gatewayChip: {
    minHeight: 34,
    maxWidth: 180,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayChipActive: {
    borderColor: '#2A9D8F',
    backgroundColor: '#264653',
  },
  gatewayChipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  gatewayChipTextActive: {
    color: '#E6FFFB',
  },
  cardsScroller: {
    paddingLeft: 16,
  },
  cardsRow: {
    paddingRight: 16,
    gap: 12,
  },
  card: {
    width: 180,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  cardValue: {
    color: '#F8FAFC',
    fontSize: 21,
    fontWeight: '700',
  },
  cardHint: {
    color: '#60A5FA',
    fontSize: 12,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  errorBox: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  errorTitle: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    color: '#FECACA',
    fontSize: 12,
    lineHeight: 16,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    marginHorizontal: 16,
    paddingTop: 12,
    overflow: 'hidden',
  },
  panelTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  sectionHint: {
    color: '#94A3B8',
    fontSize: 12,
    paddingHorizontal: 14,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
  },
  costHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
  },
  costWindowRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  costWindowChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0F172A',
  },
  costWindowChipSelected: {
    borderColor: '#22D3EE',
    backgroundColor: '#123548',
  },
  costWindowChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  costWindowChipTextSelected: {
    color: '#E0F2FE',
  },
  costSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  sectionResetButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0F172A',
  },
  sectionResetButtonText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionOrderList: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
  },
  sectionOrderItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionOrderLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  sectionOrderActions: {
    flexDirection: 'row',
    gap: 6,
  },
  sectionOrderButton: {
    width: 34,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#264653',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionOrderButtonDisabled: {
    opacity: 0.35,
  },
  sectionOrderButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  detailList: {
    gap: 8,
    padding: 12,
    paddingTop: 10,
  },
  detailItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  detailMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  detailTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  detailMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  detailMuted: {
    color: '#64748B',
    fontSize: 12,
  },
  usageCard: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 6,
  },
  latencyRow: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 6,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usageName: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  usageMeta: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  usageTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  usageFill: {
    height: 8,
    backgroundColor: '#22C55E',
  },
  chartLoading: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chartLoadingText: {
    color: '#64748B',
    fontSize: 12,
  },
  intervalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
  },
  intervalChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  intervalChipSelected: {
    backgroundColor: '#264653',
    borderColor: '#264653',
  },
  intervalChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  intervalChipTextSelected: {
    color: '#FFFFFF',
  },
  footerMeta: {
    color: '#64748B',
    fontSize: 12,
    marginHorizontal: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#020617CC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 8,
  },
  modalCardLarge: {
    width: '100%',
    maxHeight: '82%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 8,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  modalSubTitle: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  modalLine: {
    color: '#94A3B8',
    fontSize: 12,
  },
  modalButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 10,
    backgroundColor: '#1D4ED8',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: '#DBEAFE',
    fontSize: 13,
    fontWeight: '700',
  },
  modalMessagesList: {
    maxHeight: 280,
  },
  modalMessagesContent: {
    gap: 8,
    paddingBottom: 6,
  },
  modalMessageItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    gap: 4,
  },
  modalMessageHeader: {
    color: '#93C5FD',
    fontSize: 10,
    fontWeight: '700',
  },
  modalMessageContent: {
    color: '#E2E8F0',
    fontSize: 12,
    lineHeight: 16,
  },
  surfacePreviewCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 10,
    gap: 4,
  },
  surfaceSwitchRow: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 8,
  },
  surfaceSwitchLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  surfaceSwitchGroup: {
    gap: 6,
  },
  surfaceSwitchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  surfaceSwitchText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  surfaceGuide: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingTop: 2,
  },
  surfaceGuideMuted: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingBottom: 2,
  },
  surfaceActionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 2,
  },
  surfaceActionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 8,
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D4ED8',
  },
  surfaceActionButtonDisabled: {
    opacity: 0.65,
  },
  surfaceActionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  surfaceActionButtonMuted: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  surfaceActionButtonMutedText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  surfacePreviewStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  surfacePreviewStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  surfacePreviewStatusOnline: {
    backgroundColor: '#2A9D8F',
  },
  surfacePreviewStatusDegraded: {
    backgroundColor: '#B67A00',
  },
  surfacePreviewStatusOffline: {
    backgroundColor: '#B23A48',
  },
  surfacePreviewStatusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  surfacePreviewTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  surfacePreviewMetaStrong: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  surfacePreviewMeta: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  surfacePreviewHint: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
  },
  surfacePreviewError: {
    color: '#9E3043',
    fontSize: 12,
    lineHeight: 18,
  },
});
