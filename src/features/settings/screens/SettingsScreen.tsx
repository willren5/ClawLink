import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '../../../lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { getVisibleGatewayProfiles, HIDDEN_DEBUG_PROFILE_ID } from '../../connection/debugProfile';
import { useDashboardStore } from '../../dashboard/store/dashboardStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useAuditLogStore } from '../../security/store/auditLogStore';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_DASHBOARD_SECTION_ORDER,
  normalizeAccentColor,
  type DashboardSectionKey,
  type ThemePreference,
  useAppPreferencesStore,
} from '../store/preferencesStore';
import { buildSystemSurfaceSnapshot, publishSystemSurfaces, stopSystemLiveActivity } from '../../system-surfaces/services/surfaceBridge';
import { buildDiagnosticsPayload } from '../services/diagnosticsExport';

const ACCENT_PRESETS = ['#264653', '#2A9D8F', '#3B82F6', '#E76F51', '#B23A48', '#6D4C41'] as const;

const THEME_OPTIONS: Array<{ key: ThemePreference; labelKey: 'settings_theme_system' | 'settings_theme_light' | 'settings_theme_dark' }> =
  [
    { key: 'system', labelKey: 'settings_theme_system' },
    { key: 'light', labelKey: 'settings_theme_light' },
    { key: 'dark', labelKey: 'settings_theme_dark' },
  ];

const SECTION_KEYS = DEFAULT_DASHBOARD_SECTION_ORDER;

function sanitizeSectionOrder(order: DashboardSectionKey[]): DashboardSectionKey[] {
  const deduped = order.filter((item, index) => order.indexOf(item) === index);
  const filtered = deduped.filter((item): item is DashboardSectionKey => SECTION_KEYS.includes(item));
  const missing = SECTION_KEYS.filter((item) => !filtered.includes(item));
  return [...filtered, ...missing];
}

export function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, t } = useI18n();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();

  const themePreference = useAppPreferencesStore((state) => state.themePreference);
  const setThemePreference = useAppPreferencesStore((state) => state.setThemePreference);
  const setAccentColor = useAppPreferencesStore((state) => state.setAccentColor);
  const resetAppearance = useAppPreferencesStore((state) => state.resetAppearance);
  const resetAllPreferences = useAppPreferencesStore((state) => state.resetAllPreferences);
  const liveActivityEnabled = useAppPreferencesStore((state) => state.liveActivityEnabled);
  const dynamicIslandEnabled = useAppPreferencesStore((state) => state.dynamicIslandEnabled);
  const widgetEnabled = useAppPreferencesStore((state) => state.widgetEnabled);
  const setLiveActivityEnabled = useAppPreferencesStore((state) => state.setLiveActivityEnabled);
  const setDynamicIslandEnabled = useAppPreferencesStore((state) => state.setDynamicIslandEnabled);
  const setWidgetEnabled = useAppPreferencesStore((state) => state.setWidgetEnabled);
  const dashboardSectionOrder = useAppPreferencesStore((state) => state.dashboardSectionOrder);
  const moveDashboardSection = useAppPreferencesStore((state) => state.moveDashboardSection);
  const resetDashboardSectionOrder = useAppPreferencesStore((state) => state.resetDashboardSectionOrder);

  const allGatewayProfiles = useConnectionStore((state) => state.profiles);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const switchGatewayProfile = useConnectionStore((state) => state.switchGatewayProfile);
  const auditEntries = useAuditLogStore((state) => state.entries);
  const clearAuditEntries = useAuditLogStore((state) => state.clearEntries);

  const [accentInput, setAccentInput] = useState(accentColor);
  const [surfacePublishing, setSurfacePublishing] = useState(false);
  const [debugExporting, setDebugExporting] = useState(false);
  const [switchingGatewayId, setSwitchingGatewayId] = useState<string | null>(null);

  const gatewayProfiles = useMemo(() => getVisibleGatewayProfiles(allGatewayProfiles), [allGatewayProfiles]);

  useEffect(() => {
    setAccentInput(accentColor);
  }, [accentColor]);

  const sectionLabelByKey = useMemo<Record<DashboardSectionKey, string>>(
    () => ({
      volume: t('dashboard_section_volume'),
      tokenModels: t('dashboard_section_tokenModels'),
      latency: t('dashboard_section_latency'),
      usage: t('dashboard_section_usage'),
      channels: t('dashboard_section_channels'),
      sessions: t('dashboard_section_sessions'),
    }),
    [t],
  );

  const orderedSections = useMemo(
    () => sanitizeSectionOrder(dashboardSectionOrder.length ? dashboardSectionOrder : [...SECTION_KEYS]),
    [dashboardSectionOrder],
  );

  const appVersion = Constants.expoConfig?.version ?? 'dev';
  const buildVersion =
    Constants.expoConfig?.ios?.buildNumber ??
    (typeof Constants.expoConfig?.android?.versionCode === 'number'
      ? String(Constants.expoConfig.android.versionCode)
      : 'dev');
  const runtimeVersion =
    typeof Constants.expoConfig?.runtimeVersion === 'string'
      ? Constants.expoConfig.runtimeVersion
      : Constants.expoConfig?.runtimeVersion
        ? JSON.stringify(Constants.expoConfig.runtimeVersion)
        : 'dev';

  const switchTrack = useMemo(
    () => ({
      false: mapColorForMode('#334155', themeMode),
      true: accentColor,
    }),
    [accentColor, themeMode],
  );

  const formatGatewayAddress = (profile: { host: string; port: number; tls: boolean }): string =>
    `${profile.tls ? 'https' : 'http'}://${profile.host}:${profile.port}`;

  const handleSwitchGateway = async (profileId: string): Promise<void> => {
    if (profileId === activeProfileId || switchingGatewayId) {
      return;
    }

    setSwitchingGatewayId(profileId);
    try {
      await switchGatewayProfile(profileId);
    } catch (error: unknown) {
      Alert.alert(
        t('settings_gateway_switch_failed_title'),
        error instanceof Error ? error.message : t('settings_gateway_switch_failed_body'),
      );
    } finally {
      setSwitchingGatewayId(null);
    }
  };

  const handleApplyAccent = (): void => {
    const normalized = normalizeAccentColor(accentInput);
    if (!normalized) {
      Alert.alert(t('settings_accent_invalid_title'), t('settings_accent_invalid_body'));
      return;
    }

    setAccentColor(normalized);
  };

  const handlePublishSurface = async (): Promise<void> => {
    setSurfacePublishing(true);
    try {
      await publishSystemSurfaces(buildSystemSurfaceSnapshot());
      Alert.alert(t('common_ok'), t('settings_surface_publish_ok'));
    } catch (error: unknown) {
      Alert.alert(
        t('settings_surface_publish_failed_title'),
        error instanceof Error ? error.message : t('settings_surface_publish_failed_body'),
      );
    } finally {
      setSurfacePublishing(false);
    }
  };

  const handleExportDebug = async (): Promise<void> => {
    setDebugExporting(true);
    try {
      const connection = useConnectionStore.getState();
      const dashboard = useDashboardStore.getState();
      const chat = useChatStore.getState();
      const preferences = useAppPreferencesStore.getState();
      const diagnostics = buildDiagnosticsPayload({
        generatedAt: new Date().toISOString(),
        app: {
          name: Constants.expoConfig?.name ?? 'ClawLink',
          version: appVersion,
          build: buildVersion,
          runtimeVersion,
          platform: Platform.OS,
          debug: __DEV__,
        },
        preferences: {
          language: preferences.language,
          themePreference: preferences.themePreference,
          accentColor: preferences.accentColor,
          liveActivityEnabled: preferences.liveActivityEnabled,
          dynamicIslandEnabled: preferences.dynamicIslandEnabled,
          widgetEnabled: preferences.widgetEnabled,
          dashboardSectionOrder: preferences.dashboardSectionOrder,
        },
        connection: {
          status: connection.connectionStatus,
          activeProfileId: connection.activeProfileId,
          profileCount: getVisibleGatewayProfiles(connection.profiles).length,
          hiddenDebugProfilePresent: connection.profiles.some((profile) => profile.id === HIDDEN_DEBUG_PROFILE_ID),
          lastHealthCheckAt: connection.lastHealthCheckAt,
          lastError: connection.lastError,
          tokenExpiresAt: connection.tokenExpiresAt,
          tokenExpiringSoon: connection.tokenExpiringSoon,
          tokenRefreshAvailable: connection.tokenRefreshAvailable,
        },
        dashboard: {
          lastFetchedAt: dashboard.snapshot.fetchedAt,
          activeSessions: dashboard.snapshot.sessions.length,
          activeChannels: dashboard.snapshot.channels.length,
          refreshIntervalSeconds: dashboard.refreshInterval,
          lastError: dashboard.lastError,
        },
        chat: {
          activeAgentId: chat.activeAgentId,
          activeSessionId: chat.activeSessionId,
          sessionCount: Object.keys(chat.sessions).length,
          loadedSessionCount: Object.keys(chat.messagesBySession).length,
          pendingQueueCount: chat.pendingQueue.length,
          failedOutboundCount: Object.keys(chat.failedOutbound).length,
          lastError: chat.lastError,
          streaming: chat.isStreaming,
          syncing: chat.isSyncing,
        },
        auditEntries,
      });

      const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!directory) {
        throw new Error('No writable app directory available.');
      }

      const fileUri = `${directory}clawlink-debug-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(diagnostics, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Share.share(
        Platform.select({
          ios: {
            url: fileUri,
            message: t('settings_debug_share_message'),
          },
          default: {
            url: fileUri,
            message: `${t('settings_debug_share_message')} ${fileUri}`,
          },
        }) ?? { message: fileUri },
      );
    } catch (error: unknown) {
      Alert.alert(
        t('settings_debug_export_failed_title'),
        error instanceof Error ? error.message : t('settings_debug_export_failed_body'),
      );
    } finally {
      setDebugExporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 116, 132) }]}
    >
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t('settings_title')}</Text>
        <Text style={styles.heroSubtitle}>{t('settings_subtitle')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_language_title')}</Text>
        <View style={styles.segmentRow}>
          <Pressable
            style={[
              styles.segmentButton,
              language === 'zh' && styles.segmentButtonSelected,
              { borderColor: accentColor },
              language === 'zh' && { backgroundColor: accentColor },
            ]}
            onPress={() => {
              setLanguage('zh');
            }}
          >
            <Text style={[styles.segmentButtonText, language === 'zh' && styles.segmentButtonTextSelected]}>中文</Text>
          </Pressable>
          <Pressable
            style={[
              styles.segmentButton,
              language === 'en' && styles.segmentButtonSelected,
              { borderColor: accentColor },
              language === 'en' && { backgroundColor: accentColor },
            ]}
            onPress={() => {
              setLanguage('en');
            }}
          >
            <Text style={[styles.segmentButtonText, language === 'en' && styles.segmentButtonTextSelected]}>English</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('settings_gateway_profiles_title')}</Text>
          <Pressable
            style={[styles.inlineActionButton, { borderColor: accentColor }]}
            onPress={() => {
              router.push('/settings/gateways');
            }}
          >
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('settings_manage_gateways')}</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>{t('settings_gateway_profiles_hint')}</Text>

        {gatewayProfiles.length === 0 ? (
          <Text style={styles.sectionHint}>{t('settings_gateway_profiles_empty')}</Text>
        ) : (
          <View style={styles.gatewayList}>
            {gatewayProfiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const switching = profile.id === switchingGatewayId;

              return (
                <Pressable
                  key={profile.id}
                  style={[styles.gatewayItem, active && styles.gatewayItemActive]}
                  disabled={active || !!switchingGatewayId}
                  onPress={() => {
                    void handleSwitchGateway(profile.id);
                  }}
                >
                  <View style={styles.gatewayItemMain}>
                    <Text style={[styles.gatewayItemTitle, active && styles.gatewayItemTitleActive]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    <Text style={styles.gatewayItemMeta} numberOfLines={1}>
                      {formatGatewayAddress(profile)}
                    </Text>
                  </View>
                  <View style={[styles.gatewayBadge, active ? styles.gatewayBadgeActive : styles.gatewayBadgeIdle]}>
                    {switching ? (
                      <ActivityIndicator color={active ? '#0B1220' : accentColor} size="small" />
                    ) : (
                      <Text style={[styles.gatewayBadgeText, active ? styles.gatewayBadgeTextActive : styles.gatewayBadgeTextIdle]}>
                        {active ? t('settings_gateway_profiles_active') : t('settings_gateway_profiles_switch')}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('dashboard_section_order_title')}</Text>
          <Pressable
            style={[styles.inlineActionButton, { borderColor: accentColor }]}
            onPress={() => {
              resetDashboardSectionOrder();
            }}
          >
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('dashboard_section_order_reset')}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionOrderList}>
          {orderedSections.map((section, index) => (
            <View key={section} style={styles.sectionOrderItem}>
              <Text style={styles.sectionOrderLabel}>{sectionLabelByKey[section]}</Text>
              <View style={styles.sectionOrderActions}>
                <Pressable
                  style={[styles.sectionOrderButton, index === 0 && styles.sectionOrderButtonDisabled]}
                  disabled={index === 0}
                  onPress={() => {
                    moveDashboardSection(section, 'up');
                  }}
                >
                  <Text style={styles.sectionOrderButtonText}>↑</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.sectionOrderButton,
                    index === orderedSections.length - 1 && styles.sectionOrderButtonDisabled,
                  ]}
                  disabled={index === orderedSections.length - 1}
                  onPress={() => {
                    moveDashboardSection(section, 'down');
                  }}
                >
                  <Text style={styles.sectionOrderButtonText}>↓</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_surface_title')}</Text>
        <Text style={styles.sectionHint}>{t('settings_surface_hint')}</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t('dashboard_surface_widget')}</Text>
          <View style={styles.toggleSwitchWrap}>
            <Switch value={widgetEnabled} onValueChange={setWidgetEnabled} trackColor={switchTrack} />
          </View>
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t('dashboard_surface_activity')}</Text>
          <View style={styles.toggleSwitchWrap}>
            <Switch value={liveActivityEnabled} onValueChange={setLiveActivityEnabled} trackColor={switchTrack} />
          </View>
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t('dashboard_surface_island')}</Text>
          <View style={styles.toggleSwitchWrap}>
            <Switch value={dynamicIslandEnabled} onValueChange={setDynamicIslandEnabled} trackColor={switchTrack} />
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: accentColor }, surfacePublishing && styles.buttonDisabled]}
            onPress={() => {
              void handlePublishSurface();
            }}
            disabled={surfacePublishing}
          >
            <Text style={styles.primaryButtonText}>{t('settings_surface_publish')}</Text>
          </Pressable>
          <Pressable
            style={styles.ghostButton}
            onPress={() => {
              void stopSystemLiveActivity();
            }}
          >
            <Text style={styles.ghostButtonText}>{t('settings_surface_stop')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('settings_health_bridge_title')}</Text>
          <Pressable
            style={[styles.inlineActionButton, { borderColor: accentColor }]}
            onPress={() => {
              router.push('/settings/health-bridge' as unknown as Parameters<typeof router.push>[0]);
            }}
          >
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('common_show')}</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>{t('settings_health_bridge_hint')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_appearance_title')}</Text>

        <Text style={styles.subSectionTitle}>{t('settings_theme_title')}</Text>
        <View style={styles.segmentRow}>
          {THEME_OPTIONS.map((option) => {
            const selected = themePreference === option.key;
            return (
              <Pressable
                key={option.key}
                style={[
                  styles.segmentButton,
                  selected && styles.segmentButtonSelected,
                  { borderColor: accentColor },
                  selected && { backgroundColor: accentColor },
                ]}
                onPress={() => {
                  setThemePreference(option.key);
                }}
              >
                <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.subSectionTitle}>{t('settings_accent_title')}</Text>
        <View style={styles.swatchRow}>
          {ACCENT_PRESETS.map((color) => {
            const selected = color === accentColor;
            return (
              <Pressable
                key={color}
                style={[
                  styles.swatch,
                  { backgroundColor: color, borderColor: selected ? mapColorForMode('#E2E8F0', themeMode) : '#FFFFFF22' },
                ]}
                onPress={() => {
                  setAccentColor(color);
                }}
              >
                {selected && <View style={styles.swatchInner} />}
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>{t('settings_accent_hint')}</Text>

        <View style={styles.inputRow}>
          <TextInput
            value={accentInput}
            onChangeText={setAccentInput}
            placeholder={DEFAULT_ACCENT_COLOR}
            placeholderTextColor={mapColorForMode('#64748B', themeMode)}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable
            style={[styles.inlineActionButton, { borderColor: accentColor }]}
            onPress={handleApplyAccent}
          >
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('settings_accent_apply')}</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.ghostButton}
          onPress={() => {
            resetAppearance();
            setAccentInput(DEFAULT_ACCENT_COLOR);
          }}
        >
          <Text style={styles.ghostButtonText}>{t('settings_reset_appearance')}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_about_title')}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('settings_about_version')}</Text>
          <Text style={styles.metaValue}>{appVersion}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('settings_about_build')}</Text>
          <Text style={styles.metaValue}>{buildVersion}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('settings_about_runtime')}</Text>
          <Text style={styles.metaValue}>{runtimeVersion}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_debug_title')}</Text>
        <Text style={styles.sectionHint}>{t('settings_debug_hint')}</Text>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: accentColor }, debugExporting && styles.buttonDisabled]}
            onPress={() => {
              void handleExportDebug();
            }}
            disabled={debugExporting}
          >
            <Text style={styles.primaryButtonText}>{t('settings_debug_export')}</Text>
          </Pressable>
          <Pressable
            style={styles.ghostButton}
            onPress={() => {
              router.push('/settings/gateways');
            }}
          >
            <Text style={styles.ghostButtonText}>{t('settings_manage_gateways')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('settings_audit_title')}</Text>
          <Pressable style={[styles.inlineActionButton, { borderColor: accentColor }]} onPress={clearAuditEntries}>
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('settings_audit_clear')}</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>{t('settings_audit_hint')}</Text>

        {auditEntries.length === 0 ? (
          <Text style={styles.sectionHint}>{t('settings_audit_empty')}</Text>
        ) : (
          <View style={styles.auditList}>
            {[...auditEntries].slice(-20).reverse().map((entry) => (
              <View key={entry.id} style={styles.auditItem}>
                <Text style={styles.auditAction}>
                  {entry.action} · {entry.result}
                </Text>
                <Text style={styles.auditMeta}>
                  {entry.target} · {new Date(entry.timestamp).toLocaleString()}
                </Text>
                {!!entry.detail && <Text style={styles.auditDetail}>{entry.detail}</Text>}
              </View>
            ))}
          </View>
        )}
      </View>

      <Pressable
        style={styles.resetAllButton}
        onPress={() => {
          Alert.alert(t('settings_reset_all_title'), t('settings_reset_all_body'), [
            { text: t('common_cancel'), style: 'cancel' },
            {
              text: t('settings_reset_all_action'),
              style: 'destructive',
              onPress: () => {
                resetAllPreferences();
                setAccentInput(DEFAULT_ACCENT_COLOR);
              },
            },
          ]);
        }}
      >
        <Text style={styles.resetAllText}>{t('settings_reset_all')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = createAdaptiveStyles({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 12,
  },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  heroTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  heroSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  subSectionTitle: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionHint: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentButton: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  segmentButtonSelected: {
    backgroundColor: '#264653',
  },
  segmentButtonText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  segmentButtonTextSelected: {
    color: '#FFFFFF',
  },
  sectionOrderList: {
    gap: 8,
  },
  sectionOrderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
  },
  sectionOrderLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    paddingRight: 10,
  },
  sectionOrderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionOrderButton: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
  },
  sectionOrderButtonDisabled: {
    opacity: 0.35,
  },
  sectionOrderButtonText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  gatewayList: {
    gap: 8,
  },
  gatewayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  gatewayItemActive: {
    borderColor: '#2A9D8F',
    backgroundColor: '#123538',
  },
  gatewayItemMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  gatewayItemTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  gatewayItemTitleActive: {
    color: '#E6FFFB',
  },
  gatewayItemMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  gatewayBadge: {
    minHeight: 30,
    minWidth: 66,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  gatewayBadgeActive: {
    borderColor: '#2A9D8F',
    backgroundColor: '#9FF7EC',
  },
  gatewayBadgeIdle: {
    borderColor: '#334155',
    backgroundColor: '#0B1220',
  },
  gatewayBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gatewayBadgeTextActive: {
    color: '#0B1220',
  },
  gatewayBadgeTextIdle: {
    color: '#CBD5E1',
  },
  inlineActionButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
  },
  inlineActionText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  toggleLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleSwitchWrap: {
    width: 58,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  ghostButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  ghostButtonText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 10,
    color: '#E2E8F0',
    backgroundColor: '#0F172A',
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    minHeight: 40,
  },
  metaLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  metaValue: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: '58%',
    textAlign: 'right',
  },
  auditList: {
    gap: 8,
  },
  auditItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  auditAction: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  auditMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  auditDetail: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 15,
  },
  resetAllButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetAllText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '700',
  },
});
