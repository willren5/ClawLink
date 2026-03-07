import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '../../../lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import { describeAlertQuickAction } from '../incidentDefinitions';
import { executeAlertQuickAction } from '../services/incidentActions';
import { useAlertStore, type AlertHistoryItem } from '../store/alertStore';

type InboxFilter = 'active' | 'acknowledged' | 'resolved' | 'all';

function localized(language: 'zh' | 'en', zh: string, en: string): string {
  return language === 'zh' ? zh : en;
}

function severityColor(severity: AlertHistoryItem['severity'], mode: 'light' | 'dark'): string {
  switch (severity) {
    case 'critical':
      return mapColorForMode('#EF4444', mode);
    case 'warning':
      return mapColorForMode('#F59E0B', mode);
    default:
      return mapColorForMode('#22C55E', mode);
  }
}

function statusLabel(status: AlertHistoryItem['status'], language: 'zh' | 'en'): string {
  switch (status) {
    case 'acknowledged':
      return localized(language, '已确认', 'Acknowledged');
    case 'resolved':
      return localized(language, '已解决', 'Resolved');
    default:
      return localized(language, '处理中', 'Active');
  }
}

function routeForDeepLink(deepLink: string): '/(tabs)/dashboard' | '/(tabs)/monitor' | '/(tabs)/chat' | '/(tabs)/agents' {
  if (deepLink.includes('://monitor')) {
    return '/(tabs)/monitor';
  }
  if (deepLink.includes('://chat')) {
    return '/(tabs)/chat';
  }
  if (deepLink.includes('://agents')) {
    return '/(tabs)/agents';
  }
  return '/(tabs)/dashboard';
}

export function IncidentInboxScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { language } = useI18n();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const alerts = useAlertStore((state) => state.alerts);
  const markAllRead = useAlertStore((state) => state.markAllRead);
  const acknowledgeAlert = useAlertStore((state) => state.acknowledgeAlert);
  const resolveAlert = useAlertStore((state) => state.resolveAlert);
  const snoozeAlert = useAlertStore((state) => state.snoozeAlert);
  const clearAlerts = useAlertStore((state) => state.clearAlerts);
  const [filter, setFilter] = useState<InboxFilter>('active');
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const filteredAlerts = useMemo(() => {
    if (filter === 'all') {
      return alerts;
    }

    return alerts.filter((item) => item.status === filter);
  }, [alerts, filter]);
  const unreadCount = useMemo(() => alerts.filter((item) => !item.read).length, [alerts]);

  const filters = useMemo(
    () =>
      [
        { key: 'active', label: localized(language, '处理中', 'Active') },
        { key: 'acknowledged', label: localized(language, '已确认', 'Acknowledged') },
        { key: 'resolved', label: localized(language, '已解决', 'Resolved') },
        { key: 'all', label: localized(language, '全部', 'All') },
      ] as Array<{ key: InboxFilter; label: string }>,
    [language],
  );

  const handleExecuteQuickAction = async (alert: AlertHistoryItem, actionId: AlertHistoryItem['quickActions'][number]): Promise<void> => {
    setBusyActionId(`${alert.id}:${actionId}`);
    try {
      await executeAlertQuickAction(actionId);
      const descriptor = describeAlertQuickAction(actionId, language);
      if (descriptor.deepLink) {
        router.replace(routeForDeepLink(descriptor.deepLink));
      }
      acknowledgeAlert(alert.id);
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 112, 132) }]}
    >
      <View style={styles.hero}>
        <View style={styles.heroMain}>
          <Text style={styles.heroTitle}>{localized(language, 'Incident Inbox', 'Incident Inbox')}</Text>
          <Text style={styles.heroSubtitle}>
            {localized(language, '把断连、队列积压、Agent 异常收进一个收件箱。', 'Collect disconnects, queue backlog, and agent errors in one place.')}
          </Text>
        </View>
        <Pressable
          style={[styles.heroAction, { borderColor: accentColor }]}
          onPress={() => {
            router.push('/settings');
          }}
        >
          <Text style={[styles.heroActionText, { color: accentColor }]}>
            {localized(language, '设置', 'Settings')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{localized(language, '未读', 'Unread')}</Text>
          <Text style={styles.summaryValue}>{unreadCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{localized(language, '当前筛选', 'Filter')}</Text>
          <Text style={styles.summaryValueSmall}>{filters.find((item) => item.key === filter)?.label}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filters.map((item) => {
          const selected = item.key === filter;
          return (
            <Pressable
              key={item.key}
              style={[
                styles.filterChip,
                selected && styles.filterChipSelected,
                { borderColor: selected ? accentColor : mapColorForMode('#334155', themeMode) },
              ]}
              onPress={() => {
                setFilter(item.key);
              }}
            >
              <Text style={[styles.filterChipText, selected && { color: accentColor }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.inlineActionButton, { borderColor: accentColor }]}
          onPress={markAllRead}
        >
          <Text style={[styles.inlineActionText, { color: accentColor }]}>
            {localized(language, '全部标已读', 'Mark all read')}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.inlineActionButton, { borderColor: mapColorForMode('#7F1D1D', themeMode) }]}
          onPress={() => {
            Alert.alert(
              localized(language, '清空收件箱', 'Clear inbox'),
              localized(language, '确认清空当前 incident 历史吗？', 'Clear the current incident history?'),
              [
                { text: localized(language, '取消', 'Cancel'), style: 'cancel' },
                {
                  text: localized(language, '清空', 'Clear'),
                  style: 'destructive',
                  onPress: clearAlerts,
                },
              ],
            );
          }}
        >
          <Text style={styles.inlineActionText}>{localized(language, '清空', 'Clear')}</Text>
        </Pressable>
      </View>

      {filteredAlerts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{localized(language, '暂时没有 incident', 'No incidents right now')}</Text>
          <Text style={styles.emptyText}>
            {localized(language, '当网关断连、队列积压或 Agent 异常时，这里会出现可执行的处理项。', 'Disconnects, queue backlog, and agent errors will show up here with runnable actions.')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredAlerts.map((alert) => {
            const severity = severityColor(alert.severity, themeMode);
            return (
              <View key={alert.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderMain}>
                    <View style={[styles.severityDot, { backgroundColor: severity }]} />
                    <Text style={[styles.statusBadge, { color: severity }]}>{statusLabel(alert.status, language)}</Text>
                    {alert.eventCount > 1 && (
                      <Text style={styles.eventCountText}>
                        {localized(language, `触发 ${alert.eventCount} 次`, `${alert.eventCount} events`)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.updatedAtText}>
                    {localized(language, '更新于', 'Updated')} {new Date(alert.updatedAt).toLocaleTimeString()}
                  </Text>
                </View>

                <Text style={styles.cardTitle}>{alert.title}</Text>
                <Text style={styles.cardBody}>{alert.body}</Text>

                <View style={styles.quickActionRow}>
                  {alert.quickActions.map((actionId) => {
                    const descriptor = describeAlertQuickAction(actionId, language);
                    const busy = busyActionId === `${alert.id}:${actionId}`;
                    return (
                      <Pressable
                        key={`${alert.id}:${actionId}`}
                        style={[styles.quickActionButton, busy && styles.quickActionButtonDisabled]}
                        disabled={busy}
                        onPress={() => {
                          void handleExecuteQuickAction(alert, actionId);
                        }}
                      >
                        <Text style={styles.quickActionButtonText}>{descriptor.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.cardActionButton, { borderColor: accentColor }]}
                    onPress={() => {
                      acknowledgeAlert(alert.id);
                    }}
                  >
                    <Text style={[styles.cardActionText, { color: accentColor }]}>
                      {localized(language, '确认', 'Acknowledge')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.cardActionButton}
                    onPress={() => {
                      snoozeAlert(alert.id, 60 * 60 * 1000);
                    }}
                  >
                    <Text style={styles.cardActionText}>{localized(language, '静音 1 小时', 'Snooze 1h')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.cardActionButton}
                    onPress={() => {
                      resolveAlert(alert.id);
                    }}
                  >
                    <Text style={styles.cardActionText}>{localized(language, '标记完成', 'Resolve')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
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
    gap: 12,
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroMain: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  heroAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 4,
  },
  summaryLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    color: '#F8FAFC',
    fontSize: 30,
    fontWeight: '800',
  },
  summaryValueSmall: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: '#0F172A',
  },
  filterChipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineActionButton: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
  },
  inlineActionText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    backgroundColor: '#0B1220',
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  list: {
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 16,
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeaderMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: '800',
  },
  eventCountText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  updatedAtText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  cardBody: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 19,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickActionButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: '#16313A',
    borderWidth: 1,
    borderColor: '#264653',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionButtonDisabled: {
    opacity: 0.55,
  },
  quickActionButtonText: {
    color: '#CAFFF5',
    fontSize: 12,
    fontWeight: '700',
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardActionButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
});
