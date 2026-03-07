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

import { resolveExperimentalFeatureFlags, type ExperimentalFeatureKey } from '../../../lib/features/featureFlags';
import { useI18n } from '../../../lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { getVisibleGatewayProfiles, HIDDEN_DEBUG_PROFILE_ID } from '../../connection/debugProfile';
import { useDashboardStore } from '../../dashboard/store/dashboardStore';
import { useChatStore } from '../../chat/store/chatStore';
import { clearAllPersistedSessionMessages } from '../../chat/store/sessionMessagesStorage';
import { useAuditLogStore } from '../../security/store/auditLogStore';
import {
  SUPPORTED_PRICING_CURRENCIES,
  evaluateDailyBudget,
  formatCurrencyAmount,
  pricingCurrencyLabel,
  usePricingStore,
} from '../store/pricingStore';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_DASHBOARD_SECTION_ORDER,
  normalizeAccentColor,
  type DashboardSectionKey,
  type ThemePreference,
  useAppPreferencesStore,
} from '../store/preferencesStore';
import {
  buildSystemSurfaceSnapshot,
  publishSystemSurfaces,
  stopSystemLiveActivity,
  syncSurfacePreferences,
} from '../../system-surfaces/services/surfaceBridge';
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
  const persistChatTranscripts = useAppPreferencesStore((state) => state.persistChatTranscripts);
  const liveActivityEnabled = useAppPreferencesStore((state) => state.liveActivityEnabled);
  const dynamicIslandEnabled = useAppPreferencesStore((state) => state.dynamicIslandEnabled);
  const widgetEnabled = useAppPreferencesStore((state) => state.widgetEnabled);
  const spotlightEnabled = useAppPreferencesStore((state) => state.spotlightEnabled);
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const setLiveActivityEnabled = useAppPreferencesStore((state) => state.setLiveActivityEnabled);
  const setDynamicIslandEnabled = useAppPreferencesStore((state) => state.setDynamicIslandEnabled);
  const setWidgetEnabled = useAppPreferencesStore((state) => state.setWidgetEnabled);
  const setSpotlightEnabled = useAppPreferencesStore((state) => state.setSpotlightEnabled);
  const setPersistChatTranscripts = useAppPreferencesStore((state) => state.setPersistChatTranscripts);
  const setExperimentalFeatureEnabled = useAppPreferencesStore((state) => state.setExperimentalFeatureEnabled);
  const resetExperimentalFeatures = useAppPreferencesStore((state) => state.resetExperimentalFeatures);
  const dashboardSectionOrder = useAppPreferencesStore((state) => state.dashboardSectionOrder);
  const moveDashboardSection = useAppPreferencesStore((state) => state.moveDashboardSection);
  const resetDashboardSectionOrder = useAppPreferencesStore((state) => state.resetDashboardSectionOrder);

  const allGatewayProfiles = useConnectionStore((state) => state.profiles);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const switchGatewayProfile = useConnectionStore((state) => state.switchGatewayProfile);
  const auditEntries = useAuditLogStore((state) => state.entries);
  const clearAuditEntries = useAuditLogStore((state) => state.clearEntries);
  const pricingCurrency = usePricingStore((state) => state.currency);
  const pricing = usePricingStore((state) => state.pricing);
  const dailyBudget = usePricingStore((state) => state.dailyBudget);
  const setPricingCurrency = usePricingStore((state) => state.setCurrency);
  const setDailyBudget = usePricingStore((state) => state.setDailyBudget);
  const upsertModelPricing = usePricingStore((state) => state.upsertModelPricing);
  const removeModelPricing = usePricingStore((state) => state.removeModelPricing);
  const dashboardEstimatedCostToday = useDashboardStore((state) => state.snapshot.cards.estimatedCostToday);
  const recalculateDashboardCost = useDashboardStore((state) => state.recalculateCostEstimate);
  const recalculateChatSessionCosts = useChatStore((state) => state.recalculateSessionCosts);

  const [accentInput, setAccentInput] = useState(accentColor);
  const [surfacePublishing, setSurfacePublishing] = useState(false);
  const [debugExporting, setDebugExporting] = useState(false);
  const [switchingGatewayId, setSwitchingGatewayId] = useState<string | null>(null);
  const [dailyBudgetInput, setDailyBudgetInput] = useState(dailyBudget !== null ? String(dailyBudget) : '');
  const [pricingModelInput, setPricingModelInput] = useState('');
  const [pricingInputPrice, setPricingInputPrice] = useState('');
  const [pricingOutputPrice, setPricingOutputPrice] = useState('');
  const [editingPricingKey, setEditingPricingKey] = useState<string | null>(null);

  const gatewayProfiles = useMemo(() => getVisibleGatewayProfiles(allGatewayProfiles), [allGatewayProfiles]);

  useEffect(() => {
    setAccentInput(accentColor);
  }, [accentColor]);

  useEffect(() => {
    setDailyBudgetInput(dailyBudget !== null ? String(dailyBudget) : '');
  }, [dailyBudget]);

  useEffect(() => {
    void syncSurfacePreferences().catch(() => {
      // Preference syncing is best effort; manual refresh remains available.
    });
  }, [dynamicIslandEnabled, liveActivityEnabled, widgetEnabled]);

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
  const experimentalFeatures = useMemo(
    () => resolveExperimentalFeatureFlags(featureOverrides),
    [featureOverrides],
  );
  const experimentalFeatureRows = useMemo<Array<{ key: ExperimentalFeatureKey; label: string; hint: string }>>(
    () => [
      {
        key: 'healthBridge',
        label: 'Health Bridge',
        hint:
          language === 'zh'
            ? '控制 Apple Health 数据桥接页面与原生同步。'
            : 'Controls the Apple Health bridge UI and native sync path.',
      },
      {
        key: 'shortcutIntents',
        label: 'Shortcuts',
        hint:
          language === 'zh'
            ? '控制 iOS Shortcuts 指令在应用内的消费执行。'
            : 'Controls in-app execution of iOS Shortcuts commands.',
      },
      {
        key: 'reasoningTimeline',
        label: 'Reasoning Timeline',
        hint:
          language === 'zh'
            ? '控制聊天消息里的推理/工具时间线面板。'
            : 'Controls the reasoning/tool timeline panel in chat messages.',
      },
      {
        key: 'chatImageCarousel',
        label: 'Image Carousel',
        hint:
          language === 'zh'
            ? '控制聊天消息多图轮播与全屏预览。'
            : 'Controls multi-image carousel and full-screen preview in chat.',
      },
      {
        key: 'agentLogsPagination',
        label: 'Agent Log Pagination',
        hint:
          language === 'zh'
            ? '控制 Agent 日志的向前加载。'
            : 'Controls incremental backfill for agent logs.',
      },
    ],
    [language],
  );
  const pricingEntries = useMemo(
    () =>
      Object.entries(pricing).sort(([left], [right]) => {
        if (left.toLowerCase() === 'others') {
          return 1;
        }
        if (right.toLowerCase() === 'others') {
          return -1;
        }
        return left.localeCompare(right);
      }),
    [pricing],
  );
  const dailyBudgetStatus = useMemo(
    () => evaluateDailyBudget(dashboardEstimatedCostToday, dailyBudget),
    [dailyBudget, dashboardEstimatedCostToday],
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
  const spotlightLabel = language === 'zh' ? 'Spotlight 搜索' : 'Spotlight Search';
  const spotlightHint =
    language === 'zh'
      ? '关闭后会清理系统搜索索引，不再把网关、Agent 和会话标题暴露给 Spotlight。'
      : 'Turn off to clear system search index and stop exposing gateway, agent, and session titles to Spotlight.';
  const privacyTitle = language === 'zh' ? '隐私' : 'Privacy';
  const privacyHint =
    language === 'zh'
      ? '关闭后不再把聊天消息持久化到本地缓存。当前运行中的会话仍会保留在内存里，已落盘的历史会立即清除。'
      : 'Turn off to stop persisting chat transcripts to local cache. Current in-memory sessions remain, and existing persisted history is cleared immediately.';
  const privacyToggleLabel = language === 'zh' ? '保留本地聊天记录' : 'Persist local chat transcripts';
  const formatMoney = (value: number): string => formatCurrencyAmount(value, pricingCurrency, language);

  const resetPricingForm = (): void => {
    setEditingPricingKey(null);
    setPricingModelInput('');
    setPricingInputPrice('');
    setPricingOutputPrice('');
  };

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

  const handleApplyDailyBudget = (): void => {
    const normalized = dailyBudgetInput.trim();
    if (!normalized) {
      setDailyBudget(null);
      return;
    }

    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert(t('settings_budget_invalid_title'), t('settings_budget_invalid_body'));
      return;
    }

    setDailyBudget(parsed);
  };

  const handleSaveModelPricing = (): void => {
    const model = pricingModelInput.trim();
    const inputPerMillion = Number.parseFloat(pricingInputPrice.trim());
    const outputPerMillion = Number.parseFloat(pricingOutputPrice.trim());

    if (!model || !Number.isFinite(inputPerMillion) || inputPerMillion < 0 || !Number.isFinite(outputPerMillion) || outputPerMillion < 0) {
      Alert.alert(t('settings_pricing_invalid_title'), t('settings_pricing_invalid_body'));
      return;
    }

    upsertModelPricing(model, {
      inputPerMillion,
      outputPerMillion,
    });
    recalculateDashboardCost();
    recalculateChatSessionCosts();
    resetPricingForm();
  };

  const handleEditModelPricing = (model: string): void => {
    const current = pricing[model];
    if (!current) {
      return;
    }

    setEditingPricingKey(model);
    setPricingModelInput(model);
    setPricingInputPrice(String(current.inputPerMillion));
    setPricingOutputPrice(String(current.outputPerMillion));
  };

  const handleDeleteModelPricing = (model: string): void => {
    if (model.toLowerCase() === 'others') {
      return;
    }

    Alert.alert(t('settings_pricing_delete_title'), t('settings_pricing_delete_body'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('settings_pricing_delete_action'),
        style: 'destructive',
        onPress: () => {
          removeModelPricing(model);
          recalculateDashboardCost();
          recalculateChatSessionCosts();
          if (editingPricingKey === model) {
            resetPricingForm();
          }
        },
      },
    ]);
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
          pricingCurrency,
          dailyBudget,
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
        <Text style={styles.sectionTitle}>{privacyTitle}</Text>
        <Text style={styles.sectionHint}>{privacyHint}</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{privacyToggleLabel}</Text>
          <View style={styles.toggleSwitchWrap}>
            <Switch
              value={persistChatTranscripts}
              onValueChange={(enabled) => {
                setPersistChatTranscripts(enabled);
                if (!enabled) {
                  clearAllPersistedSessionMessages();
                }
              }}
              trackColor={switchTrack}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_pricing_title')}</Text>
        <Text style={styles.sectionHint}>
          {t('settings_pricing_hint')} {pricingCurrencyLabel(pricingCurrency, language)}
        </Text>

        <Text style={styles.subSectionTitle}>{t('settings_currency_title')}</Text>
        <View style={styles.segmentRow}>
          {SUPPORTED_PRICING_CURRENCIES.map((currency) => {
            const selected = pricingCurrency === currency;
            return (
              <Pressable
                key={currency}
                style={[
                  styles.segmentButton,
                  selected && styles.segmentButtonSelected,
                  { borderColor: accentColor },
                  selected && { backgroundColor: accentColor },
                ]}
                onPress={() => {
                  setPricingCurrency(currency);
                }}
              >
                <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                  {pricingCurrencyLabel(currency, language)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>{t('settings_currency_hint')}</Text>

        <Text style={styles.subSectionTitle}>{t('settings_budget_title')}</Text>
        <View style={styles.inputRow}>
          <TextInput
            value={dailyBudgetInput}
            onChangeText={setDailyBudgetInput}
            placeholder={t('settings_budget_placeholder')}
            placeholderTextColor={mapColorForMode('#64748B', themeMode)}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable style={[styles.inlineActionButton, { borderColor: accentColor }]} onPress={handleApplyDailyBudget}>
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('common_save')}</Text>
          </Pressable>
          <Pressable
            style={[styles.inlineActionButton, { borderColor: mapColorForMode('#334155', themeMode) }]}
            onPress={() => {
              setDailyBudget(null);
              setDailyBudgetInput('');
            }}
          >
            <Text style={styles.inlineActionText}>{t('settings_budget_clear')}</Text>
          </Pressable>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('settings_budget_today_spend')}</Text>
          <Text style={styles.metaValue}>{formatMoney(dailyBudgetStatus.spendToday)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('settings_budget_current_limit')}</Text>
          <Text style={styles.metaValue}>
            {dailyBudgetStatus.dailyBudget === null ? t('settings_budget_unset') : formatMoney(dailyBudgetStatus.dailyBudget)}
          </Text>
        </View>
        <Text style={styles.sectionHint}>
          {dailyBudgetStatus.state === 'exceeded'
            ? t('settings_budget_status_exceeded')
            : dailyBudgetStatus.state === 'near_limit'
              ? t('settings_budget_status_near')
              : dailyBudgetStatus.state === 'within_limit'
                ? t('settings_budget_status_within')
                : t('settings_budget_status_idle')}
        </Text>

        <Text style={styles.subSectionTitle}>{t('settings_pricing_editor_title')}</Text>
        <TextInput
          value={pricingModelInput}
          onChangeText={setPricingModelInput}
          placeholder={t('settings_pricing_model_placeholder')}
          placeholderTextColor={mapColorForMode('#64748B', themeMode)}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <View style={styles.inputRow}>
          <TextInput
            value={pricingInputPrice}
            onChangeText={setPricingInputPrice}
            placeholder={t('settings_pricing_input_placeholder')}
            placeholderTextColor={mapColorForMode('#64748B', themeMode)}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={pricingOutputPrice}
            onChangeText={setPricingOutputPrice}
            placeholder={t('settings_pricing_output_placeholder')}
            placeholderTextColor={mapColorForMode('#64748B', themeMode)}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <View style={styles.actionRow}>
          <Pressable style={[styles.primaryButton, { backgroundColor: accentColor }]} onPress={handleSaveModelPricing}>
            <Text style={styles.primaryButtonText}>
              {editingPricingKey ? t('settings_pricing_update') : t('settings_pricing_save')}
            </Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={resetPricingForm}>
            <Text style={styles.ghostButtonText}>{t('settings_pricing_clear_form')}</Text>
          </Pressable>
        </View>

        {pricingEntries.length === 0 ? (
          <Text style={styles.sectionHint}>{t('settings_pricing_empty')}</Text>
        ) : (
          <View style={styles.pricingList}>
            {pricingEntries.map(([model, modelPricing]) => {
              const isFallback = model.toLowerCase() === 'others';
              return (
                <View key={model} style={styles.pricingItem}>
                  <View style={styles.pricingItemMain}>
                    <Text style={styles.pricingItemTitle}>{model}</Text>
                    <Text style={styles.pricingItemMeta}>
                      {t('settings_pricing_input_short')} {modelPricing.inputPerMillion.toFixed(4)} · {t('settings_pricing_output_short')}{' '}
                      {modelPricing.outputPerMillion.toFixed(4)}
                    </Text>
                  </View>
                  <View style={styles.pricingItemActions}>
                    <Pressable style={[styles.inlineActionButton, { borderColor: accentColor }]} onPress={() => handleEditModelPricing(model)}>
                      <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('settings_pricing_edit')}</Text>
                    </Pressable>
                    {isFallback ? (
                      <View style={styles.pricingFallbackBadge}>
                        <Text style={styles.pricingFallbackText}>{t('settings_pricing_fallback')}</Text>
                      </View>
                    ) : (
                      <Pressable
                        style={[styles.inlineActionButton, { borderColor: mapColorForMode('#7F1D1D', themeMode) }]}
                        onPress={() => handleDeleteModelPricing(model)}
                      >
                        <Text style={styles.pricingDeleteText}>{t('settings_pricing_delete')}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
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
        {Platform.OS === 'ios' && (
          <>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{spotlightLabel}</Text>
              <View style={styles.toggleSwitchWrap}>
                <Switch value={spotlightEnabled} onValueChange={setSpotlightEnabled} trackColor={switchTrack} />
              </View>
            </View>
            <Text style={styles.sectionHint}>{spotlightHint}</Text>
          </>
        )}

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
          <Text style={styles.sectionTitle}>{language === 'zh' ? 'Experimental Features' : 'Experimental Features'}</Text>
          <Pressable
            style={[styles.inlineActionButton, { borderColor: accentColor }]}
            onPress={() => {
              resetExperimentalFeatures();
            }}
          >
            <Text style={[styles.inlineActionText, { color: accentColor }]}>{t('dashboard_section_order_reset')}</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>
          {language === 'zh'
            ? '轻量 feature flag 开关。可按构建默认值灰度，也可在本机覆盖。'
            : 'Lightweight feature flags. Defaults can be rolled out per build and overridden locally.'}
        </Text>

        {experimentalFeatureRows.map((feature) => (
          <View key={feature.key}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{feature.label}</Text>
              <View style={styles.toggleSwitchWrap}>
                <Switch
                  value={experimentalFeatures[feature.key]}
                  onValueChange={(enabled) => {
                    setExperimentalFeatureEnabled(feature.key, enabled);
                  }}
                  trackColor={switchTrack}
                />
              </View>
            </View>
            <Text style={styles.sectionHint}>{feature.hint}</Text>
          </View>
        ))}
      </View>

      {experimentalFeatures.healthBridge && (
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
      )}

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
  pricingList: {
    gap: 8,
  },
  pricingItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  pricingItemMain: {
    gap: 2,
  },
  pricingItemTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  pricingItemMeta: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
  },
  pricingItemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pricingFallbackBadge: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#123538',
    borderWidth: 1,
    borderColor: '#2A9D8F',
  },
  pricingFallbackText: {
    color: '#CFFAFE',
    fontSize: 11,
    fontWeight: '700',
  },
  pricingDeleteText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
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
