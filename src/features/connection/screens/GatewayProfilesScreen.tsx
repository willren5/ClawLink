import { useMemo } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { createAdaptiveStyles } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../store/connectionStore';
import { getVisibleGatewayProfiles } from '../debugProfile';
import type { GatewayProfile } from '../types';
import { useI18n } from '../../../lib/i18n';

function formatProfileAddress(profile: GatewayProfile): string {
  const protocol = profile.tls ? 'https' : 'http';
  return `${protocol}://${profile.host}:${profile.port}`;
}

export function GatewayProfilesScreen(): JSX.Element {
  const { language } = useI18n();
  const router = useRouter();
  const profiles = useConnectionStore((state) => state.profiles);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const switchGatewayProfile = useConnectionStore((state) => state.switchGatewayProfile);
  const removeGatewayProfile = useConnectionStore((state) => state.removeGatewayProfile);
  const visibleProfiles = useMemo(() => getVisibleGatewayProfiles(profiles), [profiles]);

  const localized = (zh: string, en: string): string => (language === 'zh' ? zh : en);

  const handleSwitch = async (profileId: string): Promise<void> => {
    try {
      await switchGatewayProfile(profileId);
      router.replace('/(tabs)/dashboard');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : localized('切换失败，请稍后再试。', 'Failed to switch gateway. Try again later.');
      Alert.alert(localized('切换网关失败', 'Switch gateway failed'), message);
    }
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
        <Text style={styles.title}>{localized('已保存网关', 'Saved Gateways')}</Text>
        <Pressable style={styles.addButton} onPress={() => router.push('/connection')}>
          <Text style={styles.addButtonText}>{localized('新增', 'Add')}</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>{localized('点“使用”即可切换到该网关。', 'Tap "Use" to switch to this gateway.')}</Text>

      <FlatList
        data={visibleProfiles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visibleProfiles.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => {
          const isActive = item.id === activeProfileId;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <View style={[styles.badge, isActive ? styles.badgeActive : styles.badgeIdle]}>
                  <Text style={[styles.badgeText, isActive ? styles.badgeTextActive : styles.badgeTextIdle]}>
                    {isActive ? localized('当前使用中', 'Current') : localized('已保存', 'Saved')}
                  </Text>
                </View>
              </View>

              <Text style={styles.cardAddress}>{formatProfileAddress(item)}</Text>
              <Text style={styles.cardMeta}>
                {localized('上次连接', 'Last connected')}:{' '}
                {item.lastConnectedAt ? new Date(item.lastConnectedAt).toLocaleString() : localized('从未连接', 'Never')}
              </Text>

              <View style={styles.cardActions}>
                <Pressable
                  style={[styles.actionButton, styles.primaryAction]}
                  onPress={() => {
                    void handleSwitch(item.id);
                  }}
                >
                  <Text style={styles.primaryActionText}>{localized('使用', 'Use')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, styles.secondaryAction]}
                  onPress={() => {
                    handleDelete(item);
                  }}
                >
                  <Text style={styles.secondaryActionText}>{localized('删除', 'Delete')}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{localized('还没有保存任何网关', 'No saved gateways yet')}</Text>
            <Text style={styles.emptyText}>
              {localized('先添加一个网关，才能使用 Dashboard / Monitor / Chat。', 'Add a gateway first to use Dashboard / Monitor / Chat.')}
            </Text>
            <Pressable style={styles.emptyButton} onPress={() => router.push('/connection')}>
              <Text style={styles.emptyButtonText}>{localized('立即添加', 'Add now')}</Text>
            </Pressable>
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
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addButtonText: {
    color: '#EFF6FF',
    fontWeight: '700',
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
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    paddingRight: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeActive: {
    backgroundColor: '#065F46',
  },
  badgeIdle: {
    backgroundColor: '#1F2937',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#A7F3D0',
  },
  badgeTextIdle: {
    color: '#94A3B8',
  },
  cardAddress: {
    color: '#93C5FD',
    fontSize: 13,
  },
  cardMeta: {
    color: '#64748B',
    fontSize: 12,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAction: {
    backgroundColor: '#1D4ED8',
  },
  primaryActionText: {
    color: '#DBEAFE',
    fontWeight: '700',
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
  },
  secondaryActionText: {
    color: '#FCA5A5',
    fontWeight: '700',
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
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyButtonText: {
    color: '#E0F2FE',
    fontWeight: '700',
  },
});
