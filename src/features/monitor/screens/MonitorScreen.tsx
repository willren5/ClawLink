import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { killAgent, purgeSessions, restartGateway } from '../../../lib/api';
import { authenticateAction } from '../../../lib/security/biometric';
import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../../../theme/adaptiveStyles';
import { useAuditLogStore } from '../../security/store/auditLogStore';
import { useMonitorSettingsStore } from '../store/monitorSettingsStore';
import { useGatewayLogsStream } from '../hooks/useGatewayLogsStream';
import { useHostMetricsStream } from '../hooks/useHostMetricsStream';
import type { GatewayLogEntry } from '../types';
import { useI18n } from '../../../lib/i18n';

const SPARKLINE_HEIGHT = 156;

function buildSparklinePath(values: number[], width: number, height: number, maxValue: number): string {
  if (values.length === 0 || width <= 0 || height <= 0) {
    return '';
  }

  const safeMax = Math.max(1, maxValue);
  const stepX = values.length <= 1 ? width : width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * stepX;
      const y = height - (Math.max(0, value) / safeMax) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function SparklineChart(props: { series: Array<{ values: number[]; color: string }> }): JSX.Element {
  const [width, setWidth] = useState(0);

  const maxValue = useMemo(() => {
    let max = 1;
    for (const item of props.series) {
      for (const value of item.values) {
        if (Number.isFinite(value)) {
          max = Math.max(max, value);
        }
      }
    }
    return max;
  }, [props.series]);

  const handleLayout = (event: LayoutChangeEvent): void => {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    if (nextWidth !== width) {
      setWidth(nextWidth);
    }
  };

  return (
    <View style={styles.sparklineHost} onLayout={handleLayout}>
      <Svg width="100%" height={SPARKLINE_HEIGHT}>
        {props.series.map((item, index) => {
          const path = buildSparklinePath(item.values, width, SPARKLINE_HEIGHT, maxValue);
          if (!path) {
            return null;
          }
          return <Path key={`${index}:${item.color}`} d={path} stroke={item.color} strokeWidth={2} fill="none" />;
        })}
      </Svg>
    </View>
  );
}

function levelColor(level: GatewayLogEntry['level'], mode: 'light' | 'dark'): string {
  switch (level) {
    case 'DEBUG':
      return mapColorForMode('#9CA3AF', mode);
    case 'INFO':
      return mapColorForMode('#E2E8F0', mode);
    case 'WARN':
      return mapColorForMode('#FBBF24', mode);
    case 'ERROR':
      return mapColorForMode('#F87171', mode);
    default:
      return mapColorForMode('#E2E8F0', mode);
  }
}

function MetricBar(props: { label: string; value: number }): JSX.Element {
  const width = `${Math.round(Math.max(0, Math.min(100, props.value)))}%` as `${number}%`;

  return (
    <View style={styles.metricRow}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{props.label}</Text>
        <Text style={styles.metricValue}>{props.value.toFixed(0)}%</Text>
      </View>
      <View style={styles.metricTrack}>
        <View style={[styles.metricFill, { width }]} />
      </View>
    </View>
  );
}

export function MonitorScreen(): JSX.Element {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const { t } = useI18n();
  const probePort = useMonitorSettingsStore((state) => state.probePort);
  const setProbePort = useMonitorSettingsStore((state) => state.setProbePort);
  const appendAuditEntry = useAuditLogStore((state) => state.appendEntry);

  const { logs, connected, paused, togglePaused, clearLogs } = useGatewayLogsStream(isFocused);
  const {
    latest,
    connected: metricsConnected,
    unsupported,
    source: metricsSource,
    cpuHistory,
    memHistory,
    netHistory,
    gatewayTelemetry,
    gatewayLatencyHistory,
    gatewayChannelHistory,
  } =
    useHostMetricsStream(probePort, isFocused);

  const [query, setQuery] = useState('');
  const [probePortInput, setProbePortInput] = useState(String(probePort));
  const [killAgentId, setKillAgentId] = useState('');
  const listRef = useRef<ScrollView>(null);

  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return logs;
    }

    return logs.filter((item) => item.message.toLowerCase().includes(normalized));
  }, [logs, query]);
  const visibleLogs = useMemo(() => filteredLogs.slice(-220), [filteredLogs]);

  const netUpSeries = useMemo(() => netHistory.map((value) => value.up), [netHistory]);
  const netDownSeries = useMemo(() => netHistory.map((value) => value.down), [netHistory]);
  const cpuStrokeColor = useMemo(() => mapColorForMode('#22D3EE', themeMode), [themeMode]);
  const memStrokeColor = useMemo(() => mapColorForMode('#3B82F6', themeMode), [themeMode]);
  const netUpStrokeColor = useMemo(() => mapColorForMode('#14B8A6', themeMode), [themeMode]);
  const netDownStrokeColor = useMemo(() => mapColorForMode('#F59E0B', themeMode), [themeMode]);

  const handleRestartGateway = async (): Promise<void> => {
    const allowed = await authenticateAction(t('monitor_confirm_restart'));
    if (!allowed) {
      appendAuditEntry({
        action: 'restart_gateway',
        target: 'gateway',
        result: 'cancelled',
        detail: 'Biometric check cancelled',
      });
      return;
    }

    try {
      await restartGateway();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      appendAuditEntry({
        action: 'restart_gateway',
        target: 'gateway',
        result: 'success',
      });
      Alert.alert(t('monitor_alert_restart_title'), t('monitor_alert_restart_body'));
    } catch (error: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      appendAuditEntry({
        action: 'restart_gateway',
        target: 'gateway',
        result: 'failure',
        detail: error instanceof Error ? error.message : undefined,
      });
      Alert.alert(t('monitor_alert_restart_failed'), error instanceof Error ? error.message : t('monitor_alert_unknown_error'));
    }
  };

  const handlePurgeSessions = async (): Promise<void> => {
    const allowed = await authenticateAction(t('monitor_confirm_purge'));
    if (!allowed) {
      appendAuditEntry({
        action: 'purge_sessions',
        target: 'sessions',
        result: 'cancelled',
        detail: 'Biometric check cancelled',
      });
      return;
    }

    try {
      await purgeSessions();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      appendAuditEntry({
        action: 'purge_sessions',
        target: 'sessions',
        result: 'success',
      });
      Alert.alert(t('monitor_alert_purge_title'), t('monitor_alert_purge_body'));
    } catch (error: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      appendAuditEntry({
        action: 'purge_sessions',
        target: 'sessions',
        result: 'failure',
        detail: error instanceof Error ? error.message : undefined,
      });
      Alert.alert(t('monitor_alert_purge_failed'), error instanceof Error ? error.message : t('monitor_alert_unknown_error'));
    }
  };

  const handleKillAgent = async (): Promise<void> => {
    const agentId = killAgentId.trim();
    if (!agentId) {
      return;
    }

    const allowed = await authenticateAction(`${t('monitor_confirm_kill_prefix')} ${agentId}?`);
    if (!allowed) {
      appendAuditEntry({
        action: 'kill_agent',
        target: agentId,
        result: 'cancelled',
        detail: 'Biometric check cancelled',
      });
      return;
    }

    try {
      await killAgent(agentId);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      appendAuditEntry({
        action: 'kill_agent',
        target: agentId,
        result: 'success',
      });
      Alert.alert(t('monitor_alert_kill_title'), `${t('monitor_alert_kill_body')} (${agentId})`);
      setKillAgentId('');
    } catch (error: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      appendAuditEntry({
        action: 'kill_agent',
        target: agentId,
        result: 'failure',
        detail: error instanceof Error ? error.message : undefined,
      });
      Alert.alert(t('monitor_alert_kill_failed'), error instanceof Error ? error.message : t('monitor_alert_unknown_error'));
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 116, 132) }]}
    >
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>{t('monitor_logs_title')}</Text>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: connected ? mapColorForMode('#10B981', themeMode) : mapColorForMode('#F87171', themeMode) },
              ]}
            />
            <Text style={styles.statusText}>{connected ? t('monitor_connected') : t('monitor_disconnected')}</Text>
          </View>
        </View>

        <View style={styles.controlsRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('monitor_filter_placeholder')}
            placeholderTextColor="#64748B"
            style={styles.input}
          />
          <Pressable style={styles.controlButton} onPress={togglePaused}>
            <Text style={styles.controlButtonText}>{paused ? t('monitor_resume') : t('monitor_pause')}</Text>
          </Pressable>
          <Pressable style={styles.controlButton} onPress={clearLogs}>
            <Text style={styles.controlButtonText}>{t('monitor_clear')}</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={listRef}
          style={styles.logsList}
          contentContainerStyle={styles.logsListContent}
          nestedScrollEnabled
          onContentSizeChange={() => {
            if (!paused) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
        >
          {visibleLogs.map((item) => (
            <Text key={item.id} style={[styles.logLine, { color: levelColor(item.level, themeMode) }]}>
              [{new Date(item.timestamp).toLocaleTimeString()}] {item.level}: {item.message}
            </Text>
          ))}
        </ScrollView>

        {paused && (
          <Pressable
            style={styles.jumpButton}
            onPress={() => {
              listRef.current?.scrollToEnd({ animated: true });
            }}
          >
            <Text style={styles.jumpButtonText}>{t('monitor_jump_bottom')}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('monitor_probe_title')}</Text>
        <Text style={styles.metricSourceText}>
          {t('monitor_probe_source')}:{' '}
          {metricsSource === 'probe'
            ? t('monitor_probe_source_probe')
            : metricsSource === 'gateway'
              ? t('monitor_probe_source_gateway')
              : t('monitor_probe_source_none')}
        </Text>

        <View style={styles.probeRow}>
          <TextInput
            value={probePortInput}
            onChangeText={setProbePortInput}
            keyboardType="number-pad"
            placeholder={t('monitor_probe_port_placeholder')}
            placeholderTextColor="#64748B"
            style={[styles.input, styles.portInput]}
          />
          <Pressable
            style={styles.controlButton}
            onPress={() => {
              const next = Number.parseInt(probePortInput, 10);
              if (Number.isInteger(next)) {
                setProbePort(next);
              }
            }}
          >
            <Text style={styles.controlButtonText}>{t('monitor_probe_apply')}</Text>
          </Pressable>
        </View>

        {metricsSource === 'none' ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>{t('monitor_probe_unavailable_title')}</Text>
            <Text style={styles.warnText}>
              {t('monitor_probe_unavailable_body')} ws://host:{probePort}/metrics/stream.
            </Text>
            <Text style={styles.warnText}>{t('monitor_probe_unavailable_body_2')}</Text>
            {unsupported && <Text style={styles.warnText}>{t('monitor_probe_unavailable_body_3')}</Text>}
          </View>
        ) : metricsSource === 'gateway' ? (
          <>
            <View style={styles.gatewayFallbackSummary}>
              <Text style={styles.metricMini}>{t('monitor_metric_health_latency')}: {gatewayTelemetry?.latencyMs ?? 0} ms</Text>
              <Text style={styles.metricMini}>
                {t('monitor_metric_channels_running')}: {gatewayTelemetry?.runningChannels ?? 0} / {gatewayTelemetry?.configuredChannels ?? 0}
              </Text>
              <Text style={styles.metricMini}>{t('monitor_metric_sessions')}: {gatewayTelemetry?.sessionsCount ?? 0}</Text>
            </View>

            <View style={styles.chartPanel}>
              <Text style={styles.chartTitle}>{t('monitor_chart_gateway_latency')}</Text>
              <SparklineChart series={[{ values: gatewayLatencyHistory, color: memStrokeColor }]} />
              <View style={styles.chartLegendRow}>
                <Text style={[styles.chartLegend, { color: memStrokeColor }]}>{t('monitor_legend_latency')}</Text>
              </View>
            </View>

            <View style={styles.chartPanel}>
              <Text style={styles.chartTitle}>{t('monitor_chart_gateway_channels')}</Text>
              <SparklineChart series={[{ values: gatewayChannelHistory, color: netUpStrokeColor }]} />
              <View style={styles.chartLegendRow}>
                <Text style={[styles.chartLegend, { color: netUpStrokeColor }]}>{t('monitor_legend_channels')}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <MetricBar label={t('monitor_legend_cpu')} value={latest?.cpuPercent ?? 0} />
            <MetricBar label={t('monitor_legend_ram')} value={latest?.memPercent ?? 0} />

            <View style={styles.chartPanel}>
              <Text style={styles.chartTitle}>{t('monitor_chart_cpu_ram')}</Text>
              <SparklineChart
                series={[
                  { values: cpuHistory, color: cpuStrokeColor },
                  { values: memHistory, color: memStrokeColor },
                ]}
              />
              <View style={styles.chartLegendRow}>
                <Text style={[styles.chartLegend, { color: cpuStrokeColor }]}>{t('monitor_legend_cpu')}</Text>
                <Text style={[styles.chartLegend, { color: memStrokeColor }]}>{t('monitor_legend_ram')}</Text>
              </View>
            </View>

            <View style={styles.chartPanel}>
              <Text style={styles.chartTitle}>{t('monitor_chart_network')}</Text>
              <SparklineChart
                series={[
                  { values: netUpSeries, color: netUpStrokeColor },
                  { values: netDownSeries, color: netDownStrokeColor },
                ]}
              />
              <View style={styles.chartLegendRow}>
                <Text style={[styles.chartLegend, { color: netUpStrokeColor }]}>{t('monitor_network_up')}</Text>
                <Text style={[styles.chartLegend, { color: netDownStrokeColor }]}>{t('monitor_network_down')}</Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <Text style={styles.metricMini}>{t('monitor_metric_disk_io')}: {latest?.diskIo?.toFixed(2) ?? '--'} MB/s</Text>
              <Text style={styles.metricMini}>{t('monitor_metric_gpu_temp')}: {latest?.gpuTemp?.toFixed(1) ?? '--'} C</Text>
              <Text style={styles.metricMini}>{t('monitor_metric_net_up')}: {latest?.netUp?.toFixed(2) ?? '--'} KB/s</Text>
              <Text style={styles.metricMini}>{t('monitor_metric_net_down')}: {latest?.netDown?.toFixed(2) ?? '--'} KB/s</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('monitor_emergency_title')}</Text>

        <View style={styles.killRow}>
          <TextInput
            value={killAgentId}
            onChangeText={setKillAgentId}
            placeholder={t('monitor_agent_id_placeholder')}
            placeholderTextColor="#64748B"
            style={styles.input}
          />
          <Pressable
            style={[styles.controlButton, styles.killButton]}
            onPress={() => {
              void handleKillAgent();
            }}
          >
            <Text style={styles.controlButtonText}>{t('monitor_kill_agent')}</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.emergencyButton, styles.emergencyWarning]}
          onPress={() => {
            void handleRestartGateway();
          }}
        >
          <Text style={styles.emergencyText}>{t('monitor_restart_gateway')}</Text>
        </Pressable>

        <Pressable
          style={[styles.emergencyButton, styles.emergencyDanger]}
          onPress={() => {
            Alert.alert(t('monitor_confirm_purge'), t('monitor_confirm_purge_body'), [
              { text: t('common_cancel'), style: 'cancel' },
              {
                text: t('monitor_confirm_purge_action'),
                style: 'destructive',
                onPress: () => {
                  void handlePurgeSessions();
                },
              },
            ]);
          }}
        >
          <Text style={styles.emergencyText}>{t('monitor_clear_sessions')}</Text>
        </Pressable>
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
    padding: 14,
    gap: 10,
    paddingBottom: 18,
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  section: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
    padding: 10,
    gap: 8,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#E2E8F0',
    paddingHorizontal: 10,
    fontSize: 12,
    backgroundColor: '#0F172A',
  },
  controlButton: {
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  controlButtonText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  logsList: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    backgroundColor: '#020617',
  },
  logsListContent: {
    padding: 8,
    gap: 4,
  },
  logLine: {
    fontSize: 11,
    lineHeight: 14,
  },
  jumpButton: {
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 8,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpButtonText: {
    color: '#93C5FD',
    fontWeight: '600',
    fontSize: 12,
  },
  probeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  portInput: {
    maxWidth: 130,
  },
  warnBox: {
    borderWidth: 1,
    borderColor: '#7C2D12',
    borderRadius: 8,
    backgroundColor: '#1C1917',
    padding: 10,
    gap: 4,
  },
  warnTitle: {
    color: '#FBBF24',
    fontWeight: '700',
    fontSize: 12,
  },
  warnText: {
    color: '#FDE68A',
    fontSize: 11,
    lineHeight: 15,
  },
  metricSourceText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  gatewayFallbackSummary: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 4,
  },
  metricRow: {
    gap: 4,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricLabel: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  metricTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  metricFill: {
    height: '100%',
    backgroundColor: '#22D3EE',
  },
  chartPanel: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    backgroundColor: '#0F172A',
    overflow: 'hidden',
    marginTop: 2,
    paddingTop: 6,
  },
  sparklineHost: {
    minHeight: SPARKLINE_HEIGHT,
    marginTop: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#020617',
    overflow: 'hidden',
  },
  chartTitle: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  chartLegendRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  chartLegend: {
    fontSize: 10,
    fontWeight: '700',
  },
  metricsGrid: {
    marginTop: 6,
    gap: 4,
  },
  killRow: {
    flexDirection: 'row',
    gap: 8,
  },
  killButton: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
  },
  metricMini: {
    color: '#94A3B8',
    fontSize: 11,
  },
  emergencyButton: {
    borderRadius: 8,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyWarning: {
    backgroundColor: '#7C2D12',
  },
  emergencyDanger: {
    backgroundColor: '#7F1D1D',
  },
  emergencyText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
});
