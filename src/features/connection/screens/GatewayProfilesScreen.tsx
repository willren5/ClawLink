import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { resolveGatewayProfileAuth } from '../../../lib/api/gatewayAuth';
import { createAdaptiveStyles } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../store/connectionStore';
import { getVisibleGatewayProfiles } from '../debugProfile';
import { buildGatewayFullSetupBundle, buildGatewayInviteBundle } from '../services/gatewayInvite';
import type { GatewayProfile } from '../types';
import { useI18n } from '../../../lib/i18n';

type FleetFilter = 'all' | 'attention' | 'healthy';

interface GatewayFleetItem {
  profile: GatewayProfile;
  status: 'connected' | 'connecting' | 'error' | 'disconnected';
  isActive: boolean;
  lastCheck: number | null;
  lastError: string | null;
}

function formatProfileAddress(profile: GatewayProfile): string {
  const protocol = profile.tls ? 'https' : 'http';
  return `${protocol}://${profile.host}:${profile.port}`;
}

function statusMeta(
  item: GatewayFleetItem,
  localized: (zh: string, en: string) => string,
): { label: string; color: string; tone: string } {
  if (item.status === 'connected') {
    return {
      label: item.isActive ? localized('当前在线', 'Active online') : localized('健康', 'Healthy'),
      color: '#10B981',
      tone: '#064E3B',
    };
  }

  if (item.status === 'connecting') {
    return {
      label: localized('连接中', 'Connecting'),
      color: '#F59E0B',
      tone: '#78350F',
    };
  }

  if (item.status === 'error') {
    return {
      label: localized('需要处理', 'Needs attention'),
      color: '#F87171',
      tone: '#7F1D1D',
    };
  }

  return {
    label: localized('未探测到', 'Unchecked'),
    color: '#94A3B8',
    tone: '#334155',
  };
}

function formatLastCheck(value: number | null, localized: (zh: string, en: string) => string): string {
  if (!value || !Number.isFinite(value)) {
    return localized('尚未轮询', 'Not checked yet');
  }

  return `${localized('最近检查', 'Last check')}: ${new Date(value).toLocaleString()}`;
}

export function GatewayProfilesScreen(): JSX.Element {
  const { language } = useI18n();
  const router = useRouter();
  const profiles = useConnectionStore((state) => state.profiles);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const connectionStatus = useConnectionStore((state) => state.connectionStatus);
  const backgroundHealthStatus = useConnectionStore((state) => state.backgroundHealthStatus);
  const lastHealthCheckAt = useConnectionStore((state) => state.lastHealthCheckAt);
  const lastError = useConnectionStore((state) => state.lastError);
  const switchGatewayProfile = useConnectionStore((state) => state.switchGatewayProfile);
  const removeGatewayProfile = useConnectionStore((state) => state.removeGatewayProfile);
  const refreshGatewayFleet = useConnectionStore((state) => state.refreshGatewayFleet);
  const visibleProfiles = useMemo(() => getVisibleGatewayProfiles(profiles), [profiles]);
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>('all');
  const [switchingGatewayId, setSwitchingGatewayId] = useState<string | null>(null);
  const [refreshingFleet, setRefreshingFleet] = useState(false);
  const [sharingGatewayId, setSharingGatewayId] = useState<string | null>(null);

  const localized = (zh: string, en: string): string => (language === 'zh' ? zh : en);

  useEffect(() => {
    if (visibleProfiles.length === 0) {
      return;
    }

    setRefreshingFleet(true);
    void refreshGatewayFleet().finally(() => {
      setRefreshingFleet(false);
    });
  }, [refreshGatewayFleet, visibleProfiles.length]);

  const fleetItems = useMemo<GatewayFleetItem[]>(() => {
    const mapped = visibleProfiles.map((profile) => {
      const isActive = profile.id === activeProfileId;
      if (isActive) {
        return {
          profile,
          status: connectionStatus,
          isActive: true,
          lastCheck: lastHealthCheckAt,
          lastError,
        };
      }

      const background = backgroundHealthStatus[profile.id];
      return {
        profile,
        status: background?.status ?? 'disconnected',
        isActive: false,
        lastCheck: background?.lastCheck ?? null,
        lastError: background?.lastError ?? null,
      };
    });

    mapped.sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      const leftAttention = left.status === 'error' || left.status === 'connecting';
      const rightAttention = right.status === 'error' || right.status === 'connecting';
      if (leftAttention !== rightAttention) {
        return leftAttention ? -1 : 1;
      }

      const rightLast = right.lastCheck ?? right.profile.lastConnectedAt ?? 0;
      const leftLast = left.lastCheck ?? left.profile.lastConnectedAt ?? 0;
      if (rightLast !== leftLast) {
        return rightLast - leftLast;
      }

      return left.profile.name.localeCompare(right.profile.name);
    });

    return mapped;
  }, [activeProfileId, backgroundHealthStatus, connectionStatus, lastError, lastHealthCheckAt, visibleProfiles]);

  const filteredFleet = useMemo(() => {
    if (fleetFilter === 'all') {
      return fleetItems;
    }

    if (fleetFilter === 'attention') {
      return fleetItems.filter((item) => item.status === 'error' || item.status === 'connecting');
    }

    return fleetItems.filter((item) => item.status === 'connected');
  }, [fleetFilter, fleetItems]);

  const summary = useMemo(() => {
    return {
      total: fleetItems.length,
      attention: fleetItems.filter((item) => item.status === 'error' || item.status === 'connecting').length,
      healthy: fleetItems.filter((item) => item.status === 'connected').length,
    };
  }, [fleetItems]);

  const handleSwitch = async (profileId: string): Promise<void> => {
    setSwitchingGatewayId(profileId);
    try {
      await switchGatewayProfile(profileId);
      router.replace('/(tabs)/dashboard');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : localized('切换失败，请稍后再试。', 'Failed to switch gateway. Try again later.');
      Alert.alert(localized('切换网关失败', 'Switch gateway failed'), message);
    } finally {
      setSwitchingGatewayId(null);
    }
  };

  const handleRefreshFleet = async (): Promise<void> => {
    setRefreshingFleet(true);
    try {
      await refreshGatewayFleet();
    } finally {
      setRefreshingFleet(false);
    }
  };

  const shareBundle = async (title: string, message: string): Promise<void> => {
    await Share.share({
      title,
      message,
    });
  };

  const handleShare = (profile: GatewayProfile): void => {
    Alert.alert(
      localized('分享连接资料', 'Share connection bundle'),
      localized(
        '默认只分享 Host / Port / TLS / 备注，不包含 Token。若你确定接收方可信，也可以分享完整配置。',
        'The default share contains only host, port, TLS, and profile name. If the recipient is trusted, you can also share the full setup including the token.',
      ),
      [
        { text: localized('取消', 'Cancel'), style: 'cancel' },
        {
          text: localized('仅分享邀请', 'Invite only'),
          onPress: () => {
            const title = localized('ClawLink 邀请包', 'ClawLink invite bundle');
            const message = `${buildGatewayInviteBundle(profile)}\n\n${localized(
              '在另一台设备的 ClawLink 连接页粘贴这段文本即可导入。',
              'Paste this block into Smart Import on another ClawLink device.',
            )}`;
            setSharingGatewayId(profile.id);
            void shareBundle(title, message).finally(() => {
              setSharingGatewayId(null);
            });
          },
        },
        {
          text: localized('包含 Token', 'Include token'),
          style: 'destructive',
          onPress: () => {
            setSharingGatewayId(profile.id);
            void resolveGatewayProfileAuth({
              profile,
              previousRefreshAvailable: null,
              skipTokenRefresh: true,
            })
              .then((auth) => {
                const title = localized('ClawLink 完整连接包', 'ClawLink full setup bundle');
                const message = `${buildGatewayFullSetupBundle(profile, auth.token)}\n\n${localized(
                  '注意：这段文本包含完整 Token，只应发送给你信任的设备或个人。',
                  'Warning: this block contains the full token. Share it only with a trusted device or person.',
                )}`;
                return shareBundle(title, message);
              })
              .catch((error: unknown) => {
                Alert.alert(
                  localized('分享失败', 'Share failed'),
                  error instanceof Error ? error.message : localized('暂时无法读取 Token。', 'Unable to read token right now.'),
                );
              })
              .finally(() => {
                setSharingGatewayId(null);
              });
          },
        },
      ],
    );
  };

  const handleDelete = (profile: GatewayProfile): void => {
    Alert.alert(localized('删除网关', 'Delete gateway'), localized(`确认删除「${profile.name}」吗？`, `Delete "${profile.name}"?`), [
      { text: localized('取消', 'Cancel'), style: 'cancel' },
      {
        text: localized('删除', 'Delete'),
        style: 'destructive',
        onPress: () => {
          void removeGatewayProfile(profile.id);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.title}>{localized('网关指挥台', 'Gateway command center')}</Text>
          <Text style={styles.subtitle}>
            {localized('先处理异常节点，再切换或分享连接包。', 'Triage unhealthy gateways first, then switch or share bundles.')}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={[styles.topButton, styles.secondaryTopButton]} onPress={() => router.push('/connection')}>
            <Text style={styles.secondaryTopButtonText}>{localized('新增', 'Add')}</Text>
          </Pressable>
          <Pressable style={[styles.topButton, styles.primaryTopButton]} onPress={() => void handleRefreshFleet()}>
            {refreshingFleet ? <ActivityIndicator color="#EFF6FF" size="small" /> : <Text style={styles.primaryTopButtonText}>{localized('刷新全部', 'Refresh all')}</Text>}
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{localized('总节点', 'Total')}</Text>
          <Text style={styles.summaryValue}>{summary.total}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{localized('待处理', 'Attention')}</Text>
          <Text style={[styles.summaryValue, { color: '#FCA5A5' }]}>{summary.attention}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{localized('健康', 'Healthy')}</Text>
          <Text style={[styles.summaryValue, { color: '#A7F3D0' }]}>{summary.healthy}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {([
          ['all', localized('全部', 'All')],
          ['attention', localized('待处理', 'Attention')],
          ['healthy', localized('健康', 'Healthy')],
        ] as const).map(([value, label]) => {
          const selected = fleetFilter === value;
          return (
            <Pressable
              key={value}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
              onPress={() => {
                setFleetFilter(value);
              }}
            >
              <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={filteredFleet}
        keyExtractor={(item) => item.profile.id}
        contentContainerStyle={filteredFleet.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => {
          const meta = statusMeta(item, localized);
          const switching = switchingGatewayId === item.profile.id;
          const sharing = sharingGatewayId === item.profile.id;

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>{item.profile.name}</Text>
                  <Text style={styles.cardAddress}>{formatProfileAddress(item.profile)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: meta.tone }]}>
                  <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>

              <Text style={styles.cardMeta}>{formatLastCheck(item.lastCheck ?? item.profile.lastConnectedAt ?? null, localized)}</Text>
              {!!item.lastError && <Text style={styles.cardError}>{item.lastError}</Text>}

              <View style={styles.cardActions}>
                <Pressable
                  style={[styles.actionButton, styles.primaryAction]}
                  disabled={item.isActive || switching}
                  onPress={() => {
                    void handleSwitch(item.profile.id);
                  }}
                >
                  {switching ? (
                    <ActivityIndicator color="#DBEAFE" size="small" />
                  ) : (
                    <Text style={styles.primaryActionText}>{item.isActive ? localized('当前', 'Current') : localized('切换到此节点', 'Use')}</Text>
                  )}
                </Pressable>

                <Pressable
                  style={[styles.actionButton, styles.shareAction]}
                  disabled={sharing}
                  onPress={() => {
                    handleShare(item.profile);
                  }}
                >
                  {sharing ? (
                    <ActivityIndicator color="#E0F2FE" size="small" />
                  ) : (
                    <Text style={styles.shareActionText}>{localized('分享连接包', 'Share bundle')}</Text>
                  )}
                </Pressable>
              </View>

              <Pressable
                style={[styles.actionButton, styles.secondaryAction]}
                onPress={() => {
                  handleDelete(item.profile);
                }}
              >
                <Text style={styles.secondaryActionText}>{localized('删除', 'Delete')}</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {fleetFilter === 'attention'
                ? localized('当前没有待处理节点', 'No gateways need attention right now')
                : localized('还没有保存任何网关', 'No saved gateways yet')}
            </Text>
            <Text style={styles.emptyText}>
              {fleetFilter === 'attention'
                ? localized('全部节点都处于健康或未探测状态。', 'All gateways are currently healthy or unchecked.')
                : localized('先添加一个网关，才能使用 Dashboard / Monitor / Chat。', 'Add a gateway first to use Dashboard / Monitor / Chat.')}
            </Text>
            {fleetFilter !== 'attention' && (
              <Pressable style={styles.emptyButton} onPress={() => router.push('/connection')}>
                <Text style={styles.emptyButtonText}>{localized('立即添加', 'Add now')}</Text>
              </Pressable>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = createAdaptiveStyles({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  headerMain: {
    flex: 1,
    gap: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  topButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTopButton: {
    backgroundColor: '#2563EB',
  },
  secondaryTopButton: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  primaryTopButtonText: {
    color: '#EFF6FF',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryTopButtonText: {
    color: '#BFDBFE',
    fontWeight: '700',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    padding: 12,
    gap: 6,
  },
  summaryLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipSelected: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  filterChipText: {
    color: '#BFDBFE',
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: '#EFF6FF',
  },
  listContent: {
    paddingBottom: 40,
    gap: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0F172A',
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitleWrap: {
    flex: 1,
    gap: 5,
  },
  cardTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardAddress: {
    color: '#93C5FD',
    fontSize: 13,
  },
  cardMeta: {
    color: '#64748B',
    fontSize: 12,
  },
  cardError: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 18,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryAction: {
    backgroundColor: '#1D4ED8',
  },
  primaryActionText: {
    color: '#DBEAFE',
    fontWeight: '700',
    fontSize: 13,
  },
  shareAction: {
    borderWidth: 1,
    borderColor: '#0C4A6E',
    backgroundColor: '#082F49',
  },
  shareActionText: {
    color: '#BAE6FD',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
  },
  secondaryActionText: {
    color: '#FCA5A5',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 20,
    gap: 10,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyButton: {
    marginTop: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyButtonText: {
    color: '#EFF6FF',
    fontWeight: '700',
  },
});
