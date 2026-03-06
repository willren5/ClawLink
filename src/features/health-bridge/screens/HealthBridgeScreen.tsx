import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '../../../lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import {
  buildHealthBridgePreview,
  filterHealthBridgeSummary,
  getHealthBridgePermissionStatus,
  getHealthBridgeSummary,
  requestHealthBridgePermissions,
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

export function HealthBridgeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const { t, language } = useI18n();
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
  const [requesting, setRequesting] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const selectedMetrics = useMemo(
    () => METRIC_ORDER.filter((metricKey) => metrics[metricKey]),
    [metrics],
  );
  const preview = useMemo(
    () => (lastSummary ? filterHealthBridgeSummary(lastSummary, metrics) : buildHealthBridgePreview(metrics)),
    [lastSummary, metrics],
  );

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

  const handleRequestPermissions = async (): Promise<void> => {
    setRequesting(true);
    markPermissionRequested();
    try {
      const nextStatus = await requestHealthBridgePermissions(
        METRIC_ORDER.filter((metricKey) => metrics[metricKey]),
      );
      setPermissionStatus(nextStatus);
      if (nextStatus === 'authorized') {
        await refreshSummary();
        Alert.alert(t('common_ok'), t('settings_health_bridge_mock_hint'));
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleRevoke = (): void => {
    setPermissionStatus('idle');
    setEnabled(false);
    setSummary(null);
    setSummaryError(null);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
    >
      <View style={styles.section}>
        <Text style={styles.title}>{t('settings_health_bridge_title')}</Text>
        <Text style={styles.subtitle}>{t('settings_health_bridge_hint')}</Text>
      </View>

      <View style={styles.section}>
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
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings_health_bridge_permissions_title')}</Text>
        <Text style={styles.sectionHint}>{t('settings_health_bridge_permissions_hint')}</Text>
        <View style={styles.permissionPill}>
          <View style={[styles.permissionDot, { backgroundColor: permissionTone }]} />
          <Text style={styles.permissionText}>{permissionLabel}</Text>
        </View>
        {!!lastPermissionRequestedAt && (
          <Text style={styles.sectionHint}>{new Date(lastPermissionRequestedAt).toLocaleString()}</Text>
        )}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: accentColor }, requesting && styles.buttonDisabled]}
            onPress={() => {
              void handleRequestPermissions();
            }}
            disabled={requesting}
          >
            <Text style={styles.primaryButtonText}>{t('settings_health_bridge_request_permission')}</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={handleRevoke}>
            <Text style={styles.ghostButtonText}>{t('settings_health_bridge_revoke')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
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
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={styles.summaryTitleWrap}>
            <Text style={styles.sectionTitle}>{t('settings_health_bridge_mock_title')}</Text>
            <Text style={styles.sectionHint}>
              {preview.source === 'ios-healthkit'
                ? language === 'zh'
                  ? '当前显示真实 Apple Health 摘要。'
                  : 'Showing live Apple Health summary.'
                : t('settings_health_bridge_mock_hint')}
            </Text>
          </View>
          <Pressable
            style={[styles.summaryRefreshButton, (summaryLoading || permissionStatus !== 'authorized') && styles.buttonDisabled]}
            onPress={() => {
              void refreshSummary();
            }}
            disabled={summaryLoading || permissionStatus !== 'authorized'}
          >
            {summaryLoading ? (
              <ActivityIndicator color="#F8FAFC" />
            ) : (
              <Text style={styles.summaryRefreshButtonText}>{language === 'zh' ? '刷新' : 'Refresh'}</Text>
            )}
          </Pressable>
        </View>
        {preview.source === 'ios-healthkit' && (
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
              <View key={metricKey} style={styles.summaryMetricCard}>
                <Text style={styles.summaryMetricLabel}>{metricLabelByKey[metricKey]}</Text>
                <Text style={styles.summaryMetricValue}>{formattedValue}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.jsonPreview}>{JSON.stringify(preview, null, 2)}</Text>
      </View>
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
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
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
  summaryRefreshButton: {
    minWidth: 94,
    borderRadius: 12,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summaryRefreshButtonText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
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
    borderColor: '#1E293B',
    backgroundColor: '#08101D',
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
  primaryButton: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  ghostButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  ghostButtonText: {
    color: '#CBD5E1',
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#020617',
    padding: 12,
    color: '#93C5FD',
    fontSize: 12,
    lineHeight: 18,
  },
});
