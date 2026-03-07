import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassPanel } from '../../../components/LiquidGlassPanel';
import { isExperimentalFeatureEnabled } from '../../../lib/features/featureFlags';
import { useI18n } from '../../../lib/i18n';
import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import { createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import {
  buildHealthBridgePreview,
  filterHealthBridgeSummary,
  getHealthBridgePermissionStatus,
  getHealthBridgeSummary,
  isHealthBridgeSummaryFresh,
  requestHealthBridgePermissions,
  syncHealthBridgePolicyToNative,
} from '../services/healthBridge';
import { useHealthBridgeStore } from '../store/healthBridgeStore';
import type { HealthBridgeMetricKey } from '../types';

const METRIC_ORDER: HealthBridgeMetricKey[] = [
  'steps',
  'activeEnergyKcal',
  'exerciseMinutes',
  'standHours',
  'sleepDuration',
];

function withAlpha(color: string, alpha: string): string {
  const normalized = color.trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(normalized) ? `#${normalized}${alpha}` : color;
}

export function HealthBridgeScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const { t, language } = useI18n();
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const enabled = useHealthBridgeStore((state) => state.enabled);
  const permissionStatus = useHealthBridgeStore((state) => state.permissionStatus);
  const lastPermissionRequestedAt = useHealthBridgeStore((state) => state.lastPermissionRequestedAt);
  const lastSummary = useHealthBridgeStore((state) => state.lastSummary);
  const lastSummaryFetchedAt = useHealthBridgeStore((state) => state.lastSummaryFetchedAt);
  const metrics = useHealthBridgeStore((state) => state.metrics);
  const setEnabled = useHealthBridgeStore((state) => state.setEnabled);
  const toggleMetric = useHealthBridgeStore((state) => state.toggleMetric);
  const setPermissionStatus = useHealthBridgeStore((state) => state.setPermissionStatus);
  const markPermissionRequested = useHealthBridgeStore((state) => state.markPermissionRequested);
  const setSummary = useHealthBridgeStore((state) => state.setSummary);
  const activeChatAgentId = useChatStore((state) => state.activeAgentId);
  const runtimeAgentsById = useAgentsRuntimeStore((state) => state.byId);
  const [requesting, setRequesting] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [sendingSummary, setSendingSummary] = useState(false);
  const healthBridgeFeatureEnabled = useMemo(
    () => isExperimentalFeatureEnabled('healthBridge', featureOverrides),
    [featureOverrides],
  );

  const selectedMetrics = useMemo(
    () => METRIC_ORDER.filter((metricKey) => metrics[metricKey]),
    [metrics],
  );
  const hasFreshSummary = useMemo(
    () => isHealthBridgeSummaryFresh(lastSummary, lastSummaryFetchedAt),
    [lastSummary, lastSummaryFetchedAt],
  );
  const preview = useMemo(
    () => (hasFreshSummary && lastSummary ? filterHealthBridgeSummary(lastSummary, metrics) : buildHealthBridgePreview(metrics)),
    [hasFreshSummary, lastSummary, metrics],
  );
  const runtimeAgents = useMemo(() => Object.values(runtimeAgentsById), [runtimeAgentsById]);
  const targetAgent = useMemo(() => {
    if (activeChatAgentId) {
      return runtimeAgents.find((item) => item.id === activeChatAgentId) ?? null;
    }

    return runtimeAgents.find((item) => item.status !== 'disabled') ?? runtimeAgents[0] ?? null;
  }, [activeChatAgentId, runtimeAgents]);

  useEffect(() => {
    void getHealthBridgePermissionStatus()
      .then((status) => {
        setPermissionStatus(status);
      })
      .catch(() => undefined);
  }, [setPermissionStatus]);

  const permissionTone = useMemo(() => {
    switch (permissionStatus) {
      case 'authorized':
        return mapColorForMode('#22C55E', themeMode);
      case 'denied':
        return mapColorForMode('#EF4444', themeMode);
      case 'unavailable':
        return mapColorForMode('#F59E0B', themeMode);
      default:
        return mapColorForMode('#94A3B8', themeMode);
    }
  }, [permissionStatus, themeMode]);

  const permissionLabel = useMemo(() => {
    switch (permissionStatus) {
      case 'authorized':
        return t('settings_health_bridge_permission_granted');
      case 'denied':
        return t('settings_health_bridge_permission_denied');
      case 'unavailable':
        return t('settings_health_bridge_permission_unavailable');
      default:
        return t('settings_health_bridge_permission_unknown');
    }
  }, [permissionStatus, t]);

  const metricLabelByKey: Record<HealthBridgeMetricKey, string> = {
    steps: t('settings_health_bridge_metric_steps'),
    activeEnergyKcal: t('settings_health_bridge_metric_energy'),
    exerciseMinutes: t('settings_health_bridge_metric_exercise'),
    standHours: t('settings_health_bridge_metric_stand'),
    sleepDuration: t('settings_health_bridge_metric_sleep'),
  };
  const sectionSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(8,15,28,0.78)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.14)',
    }),
    [themeMode],
  );
  const secondarySurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.66)' : 'rgba(15,23,42,0.56)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.12)',
    }),
    [themeMode],
  );
  const accentButtonStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? withAlpha(accentColor, '14') : withAlpha(accentColor, '3A'),
      borderColor: themeMode === 'light' ? withAlpha(accentColor, '2B') : withAlpha(accentColor, '4F'),
    }),
    [accentColor, themeMode],
  );
  const accentButtonTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? accentColor : '#F8FAFC',
    }),
    [accentColor, themeMode],
  );
  const primaryTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#17323C' : '#F8FAFC',
    }),
    [themeMode],
  );
  const secondaryTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#4E6471' : '#9CC4BD',
    }),
    [themeMode],
  );
  const jsonPreviewTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#264653' : '#CAFFF5',
    }),
    [themeMode],
  );

  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!enabled || permissionStatus !== 'authorized') {
      return;
    }

    if (selectedMetrics.length === 0) {
      setSummary(null);
      setSummaryError(
        language === 'zh'
          ? '请至少启用一个指标后再读取 Health Bridge 摘要。'
          : 'Enable at least one metric before fetching the Health Bridge summary.',
      );
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const summary = await getHealthBridgeSummary(selectedMetrics);
      setSummary(summary);
    } catch (error: unknown) {
      setSummaryError(
        error instanceof Error
          ? error.message
          : language === 'zh'
            ? '暂时无法读取 Apple Health 数据。'
            : 'Unable to read Apple Health data right now.',
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [enabled, language, permissionStatus, selectedMetrics, setSummary]);

  useEffect(() => {
    if (!enabled || permissionStatus !== 'authorized') {
      return;
    }

    void refreshSummary();
  }, [enabled, permissionStatus, refreshSummary]);

  useEffect(() => {
    void syncHealthBridgePolicyToNative(enabled, selectedMetrics).catch(() => {
      // Native policy syncing is best effort; service call enforces again.
    });
  }, [enabled, selectedMetrics]);

  useEffect(() => {
    if (lastSummary && !hasFreshSummary) {
      setSummary(null);
    }
  }, [hasFreshSummary, lastSummary, setSummary]);

  const handleRequestPermissions = async (): Promise<void> => {
    if (selectedMetrics.length === 0) {
      setSummaryError(
        language === 'zh'
          ? '请至少启用一个指标后再请求 HealthKit 权限。'
          : 'Enable at least one metric before requesting HealthKit permission.',
      );
      return;
    }

    setRequesting(true);
    markPermissionRequested();
    try {
      const nextStatus = await requestHealthBridgePermissions(
        METRIC_ORDER.filter((metricKey) => metrics[metricKey]),
      );
      setPermissionStatus(nextStatus);
      if (nextStatus === 'authorized') {
        await refreshSummary();
        Alert.alert(
          t('common_ok'),
          language === 'zh'
            ? 'HealthKit 权限已授予，已尝试拉取最新健康摘要。'
            : 'HealthKit access granted. The latest health summary has been requested.',
        );
      }
      if (nextStatus === 'unavailable') {
        setSummaryError(
          language === 'zh'
            ? '当前构建未启用 HealthKit 能力，请在真机 Debug/Release 构建中重新安装。'
            : 'HealthKit is unavailable in this build. Reinstall a device build with HealthKit capability enabled.',
        );
      }
    } catch (error: unknown) {
      setPermissionStatus('unavailable');
      setSummaryError(
        error instanceof Error
          ? error.message
          : language === 'zh'
            ? '暂时无法完成 HealthKit 授权。'
            : 'Unable to complete HealthKit authorization right now.',
      );
    } finally {
      setRequesting(false);
    }
  };

  const handleRevoke = (): void => {
    setPermissionStatus('idle');
    setEnabled(false);
    setSummary(null);
    setSummaryError(null);
    void syncHealthBridgePolicyToNative(false, []);
  };

  const handleSendSummaryToAgent = useCallback(async (): Promise<void> => {
    if (!targetAgent) {
      setSummaryError(
        language === 'zh'
          ? '当前没有可用 Agent。请先在聊天页或 Agents 页加载一个 Agent。'
          : 'No agent is available yet. Load an agent from Chat or Agents first.',
      );
      return;
    }

    setSendingSummary(true);
    setSummaryError(null);
    try {
      const chatStore = useChatStore.getState();
      const sessionId = chatStore.createSession(targetAgent.id);
      chatStore.setActiveAgent(targetAgent.id);
      chatStore.setActiveSession(sessionId);
      chatStore.ensureSessionMessagesLoaded(sessionId);

      const summaryPrompt =
        language === 'zh'
          ? `这是我今天的 Health Bridge 摘要，请整理成简洁健康简报，并指出需要关注的异常或趋势：\n\n${JSON.stringify(preview, null, 2)}`
          : `This is my Health Bridge summary for today. Turn it into a concise health briefing and call out any anomalies or trends to watch:\n\n${JSON.stringify(preview, null, 2)}`;

      await chatStore.sendMessage({
        agentId: targetAgent.id,
        sessionId,
        content: summaryPrompt,
      });
      router.replace('/(tabs)/chat');
    } catch (error: unknown) {
      setSummaryError(
        error instanceof Error
          ? error.message
          : language === 'zh'
            ? '暂时无法把健康摘要发送给 Agent。'
            : 'Unable to send the health summary to the agent right now.',
      );
    } finally {
      setSendingSummary(false);
    }
  }, [language, preview, router, targetAgent]);

  if (!healthBridgeFeatureEnabled) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
      >
        <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
          <Text style={styles.title}>{t('settings_health_bridge_title')}</Text>
          <Text style={styles.subtitle}>
            {language === 'zh'
              ? 'Health Bridge 当前通过实验功能开关关闭。可在设置页的 Experimental Features 里重新启用。'
              : 'Health Bridge is currently disabled by feature flag. Re-enable it from Experimental Features in Settings.'}
          </Text>
        </LiquidGlassPanel>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
    >
      <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
        <Text style={styles.title}>{t('settings_health_bridge_title')}</Text>
        <Text style={styles.subtitle}>{t('settings_health_bridge_hint')}</Text>
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>{t('settings_health_bridge_enable')}</Text>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: mapColorForMode('#334155', themeMode), true: accentColor }}
            thumbColor="#F8FAFC"
          />
        </View>
        <Text style={styles.sectionHint}>{t('settings_health_bridge_enable_hint')}</Text>
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
        <Text style={styles.sectionTitle}>{t('settings_health_bridge_permissions_title')}</Text>
        <Text style={styles.sectionHint}>{t('settings_health_bridge_permissions_hint')}</Text>
        <LiquidGlassPanel style={[styles.permissionPill, secondarySurfaceStyle]}>
          <View style={[styles.permissionDot, { backgroundColor: permissionTone }]} />
          <Text style={[styles.permissionText, primaryTextStyle]}>{permissionLabel}</Text>
        </LiquidGlassPanel>
        {!!lastPermissionRequestedAt && (
          <Text style={[styles.sectionHint, secondaryTextStyle]}>{new Date(lastPermissionRequestedAt).toLocaleString()}</Text>
        )}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, accentButtonStyle, requesting && styles.buttonDisabled]}
            onPress={() => {
              void handleRequestPermissions();
            }}
            disabled={requesting}
          >
            <Text style={[styles.actionButtonText, accentButtonTextStyle]}>
              {t('settings_health_bridge_request_permission')}
            </Text>
          </Pressable>
          <Pressable style={[styles.actionButton, secondarySurfaceStyle]} onPress={handleRevoke}>
            <Text style={[styles.actionButtonText, primaryTextStyle]}>{t('settings_health_bridge_revoke')}</Text>
          </Pressable>
        </View>
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
        <Text style={styles.sectionTitle}>{t('settings_health_bridge_metrics_title')}</Text>
        <Text style={styles.sectionHint}>{t('settings_health_bridge_metrics_hint')}</Text>
        <View style={styles.metricList}>
          {METRIC_ORDER.map((metricKey) => (
            <View key={metricKey} style={styles.metricItem}>
              <Text style={styles.metricLabel}>{metricLabelByKey[metricKey]}</Text>
              <Switch
                value={metrics[metricKey]}
                onValueChange={() => toggleMetric(metricKey)}
                trackColor={{ false: mapColorForMode('#334155', themeMode), true: accentColor }}
                thumbColor="#F8FAFC"
              />
            </View>
          ))}
        </View>
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.section, sectionSurfaceStyle]}>
        <View style={styles.rowBetween}>
          <View style={styles.summaryTitleWrap}>
            <Text style={styles.sectionTitle}>{t('settings_health_bridge_mock_title')}</Text>
            <Text style={styles.sectionHint}>
              {hasFreshSummary && preview.source === 'ios-healthkit'
                ? language === 'zh'
                  ? '当前显示真实 Apple Health 摘要。'
                  : 'Showing live Apple Health summary.'
                : t('settings_health_bridge_mock_hint')}
            </Text>
          </View>
          <Pressable
            style={[
              styles.actionButtonCompact,
              accentButtonStyle,
              (summaryLoading || permissionStatus !== 'authorized' || !enabled) && styles.buttonDisabled,
            ]}
            onPress={() => {
              void refreshSummary();
            }}
            disabled={summaryLoading || permissionStatus !== 'authorized' || !enabled}
          >
            {summaryLoading ? (
              <ActivityIndicator color={themeMode === 'light' ? accentColor : '#F8FAFC'} />
            ) : (
              <Text style={[styles.actionButtonText, accentButtonTextStyle]}>
                {t('health_bridge_mock_refresh')}
              </Text>
            )}
          </Pressable>
        </View>
        {hasFreshSummary && preview.source === 'ios-healthkit' && (
          <Text style={styles.sectionHint}>
            {language === 'zh' ? '最近更新：' : 'Last fetched: '}
            {new Date(lastSummaryFetchedAt ?? Date.parse(preview.generatedAt)).toLocaleString()}
          </Text>
        )}
        {!!summaryError && <Text style={styles.summaryError}>{summaryError}</Text>}
        <View style={styles.summaryMetrics}>
          {selectedMetrics.map((metricKey) => {
            const value =
              metricKey === 'sleepDuration'
                ? preview.sleep?.durationMinutes
                : preview.activity[metricKey as keyof typeof preview.activity];
            const formattedValue =
              typeof value === 'number'
                ? metricKey === 'activeEnergyKcal'
                  ? `${value} kcal`
                  : metricKey === 'exerciseMinutes' || metricKey === 'sleepDuration'
                    ? `${value} min`
                    : `${value}`
                : language === 'zh'
                  ? '未返回'
                  : 'Not returned';

            return (
              <LiquidGlassPanel key={metricKey} style={[styles.summaryMetricCard, secondarySurfaceStyle]}>
                <Text style={[styles.summaryMetricLabel, secondaryTextStyle]}>{metricLabelByKey[metricKey]}</Text>
                <Text style={[styles.summaryMetricValue, primaryTextStyle]}>{formattedValue}</Text>
              </LiquidGlassPanel>
            );
          })}
        </View>
        <LiquidGlassPanel style={[styles.jsonPreviewCard, secondarySurfaceStyle]}>
          <Text style={[styles.jsonPreview, jsonPreviewTextStyle]}>{JSON.stringify(preview, null, 2)}</Text>
        </LiquidGlassPanel>
        <View style={styles.agentHandoffRow}>
          <View style={styles.summaryTitleWrap}>
            <Text style={styles.sectionTitle}>{language === 'zh' ? 'Agent 接力' : 'Agent handoff'}</Text>
            <Text style={styles.sectionHint}>
              {targetAgent
                ? language === 'zh'
                  ? `发送给 ${targetAgent.name}，让它把摘要整理成结论。`
                  : `Send to ${targetAgent.name} and let it turn the summary into conclusions.`
                : language === 'zh'
                  ? '还没有可用 Agent，先打开聊天或 Agents 页面拉取一次列表。'
                  : 'No agent is available yet. Open Chat or Agents once to hydrate the list.'}
            </Text>
          </View>
          <Pressable
            style={[
              styles.actionButtonCompact,
              accentButtonStyle,
              (!targetAgent || sendingSummary) && styles.buttonDisabled,
            ]}
            disabled={!targetAgent || sendingSummary}
            onPress={() => {
              void handleSendSummaryToAgent();
            }}
          >
            {sendingSummary ? (
              <ActivityIndicator color={themeMode === 'light' ? accentColor : '#F8FAFC'} />
            ) : (
              <Text style={[styles.actionButtonText, accentButtonTextStyle]}>
                {language === 'zh' ? '发送给 Agent' : 'Send to agent'}
              </Text>
            )}
          </Pressable>
        </View>
      </LiquidGlassPanel>
    </ScrollView>
  );
}

const styles = createAdaptiveStyles({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 16,
    gap: 14,
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  title: {
    color: '#E2E8F0',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHint: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permissionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  permissionDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  permissionText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryTitleWrap: {
    flex: 1,
    gap: 4,
    paddingRight: 10,
  },
  summaryError: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 18,
  },
  summaryMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryMetricCard: {
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  summaryMetricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  summaryMetricValue: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  actionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionButtonCompact: {
    minWidth: 94,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  metricList: {
    gap: 10,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metricLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  jsonPreview: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Menlo',
  },
  jsonPreviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  agentHandoffRow: {
    gap: 10,
  },
});
