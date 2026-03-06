import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { adaptiveColor, createAdaptiveStyles } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { usePermissionsStore, type PermissionKey, type PermissionState } from '../store/permissionsStore';
import { useI18n } from '../../../lib/i18n';

interface PermissionDefinition {
  key: PermissionKey;
  titleKey:
    | 'permission_item_camera_title'
    | 'permission_item_photos_title'
    | 'permission_item_microphone_title';
  descriptionKey:
    | 'permission_item_camera_desc'
    | 'permission_item_photos_desc'
    | 'permission_item_microphone_desc';
}

const PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'camera',
    titleKey: 'permission_item_camera_title',
    descriptionKey: 'permission_item_camera_desc',
  },
  {
    key: 'photos',
    titleKey: 'permission_item_photos_title',
    descriptionKey: 'permission_item_photos_desc',
  },
  {
    key: 'microphone',
    titleKey: 'permission_item_microphone_title',
    descriptionKey: 'permission_item_microphone_desc',
  },
];

function getStatusLabel(status: PermissionState, language: 'zh' | 'en'): string {
  if (status === 'granted') {
    return language === 'zh' ? '已允许' : 'Allowed';
  }

  if (status === 'denied') {
    return language === 'zh' ? '未允许' : 'Denied';
  }

  return language === 'zh' ? '待授权' : 'Pending';
}

function getStatusColor(status: PermissionState): string {
  if (status === 'granted') {
    return '#34D399';
  }

  if (status === 'denied') {
    return '#FCA5A5';
  }

  return '#FDE68A';
}

function toPermissionName(key: PermissionKey, language: 'zh' | 'en'): string {
  if (key === 'photos') {
    return language === 'zh' ? '相册' : 'Photos';
  }

  if (key === 'microphone') {
    return language === 'zh' ? '麦克风' : 'Microphone';
  }

  return language === 'zh' ? '相机' : 'Camera';
}

export function PermissionsScreen(): JSX.Element {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{
    host?: string;
    port?: string;
    token?: string;
    tls?: string;
    name?: string;
  }>();
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const permissions = usePermissionsStore((state) => state.permissions);
  const isRequesting = usePermissionsStore((state) => state.isRequesting);
  const isPreflightingLocalNetwork = usePermissionsStore((state) => state.isPreflightingLocalNetwork);
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const requestRequiredPermissions = usePermissionsStore((state) => state.requestRequiredPermissions);
  const preflightLocalNetworkPermission = usePermissionsStore((state) => state.preflightLocalNetworkPermission);
  const getMissingPermissions = usePermissionsStore((state) => state.getMissingPermissions);
  const hasRequiredPermissions = usePermissionsStore((state) => state.hasRequiredPermissions);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);

  const missingPermissions = useMemo(() => getMissingPermissions(), [getMissingPermissions, permissions]);
  const allGranted = missingPermissions.length === 0 && hasRequiredPermissions();

  useEffect(() => {
    let isMounted = true;

    const sync = async (): Promise<void> => {
      try {
        await refreshPermissions();
      } catch {
        // Keep onboarding screen usable if iOS permission services are temporarily unavailable.
      } finally {
        if (isMounted) {
          setIsLoadingSnapshot(false);
        }
      }
    };

    void sync();

    return () => {
      isMounted = false;
    };
  }, [refreshPermissions]);

  useEffect(() => {
    void preflightLocalNetworkPermission().catch(() => {
      // Best effort local-network preflight.
    });
  }, [preflightLocalNetworkPermission]);

  useEffect(() => {
    if (!allGranted) {
      return;
    }

    const connectionParams = Object.fromEntries(
      Object.entries({
        host: typeof params.host === 'string' ? params.host : undefined,
        port: typeof params.port === 'string' ? params.port : undefined,
        token: typeof params.token === 'string' ? params.token : undefined,
        tls: typeof params.tls === 'string' ? params.tls : undefined,
        name: typeof params.name === 'string' ? params.name : undefined,
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
    );

    if (Object.keys(connectionParams).length > 0) {
      router.replace({
        pathname: '/connection',
        params: connectionParams,
      });
      return;
    }

    router.replace(activeProfileId ? '/(tabs)/dashboard' : '/connection');
  }, [activeProfileId, allGranted, params.host, params.name, params.port, params.tls, params.token, router]);

  const handleGrantPermissions = async (): Promise<void> => {
    try {
      const nextPermissions = await requestRequiredPermissions();
      const deniedPermissions = getMissingPermissions(nextPermissions);

      if (deniedPermissions.length === 0) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const connectionParams = Object.fromEntries(
          Object.entries({
            host: typeof params.host === 'string' ? params.host : undefined,
            port: typeof params.port === 'string' ? params.port : undefined,
            token: typeof params.token === 'string' ? params.token : undefined,
            tls: typeof params.tls === 'string' ? params.tls : undefined,
            name: typeof params.name === 'string' ? params.name : undefined,
          }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
        );

        if (Object.keys(connectionParams).length > 0) {
          router.replace({
            pathname: '/connection',
            params: connectionParams,
          });
          return;
        }

        router.replace(activeProfileId ? '/(tabs)/dashboard' : '/connection');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        language === 'zh' ? '还差一步' : 'Almost done',
        language === 'zh'
          ? `请在系统弹窗或设置中允许：${deniedPermissions.map((item) => toPermissionName(item, language)).join('、')}，然后返回继续。`
          : `Please allow ${deniedPermissions.map((item) => toPermissionName(item, language)).join(', ')} in system prompt or Settings, then return.`,
        [
          { text: language === 'zh' ? '稍后再说' : 'Later', style: 'cancel' },
          {
            text: language === 'zh' ? '去设置打开' : 'Open Settings',
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ],
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : language === 'zh' ? '权限请求失败，请稍后再试。' : 'Permission request failed. Please try again.';
      Alert.alert(language === 'zh' ? '权限请求失败' : 'Permission request failed', message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>{t('permission_step')}</Text>
          </View>

          <Pressable
            style={styles.languageToggle}
            onPress={() => {
              setLanguage(language === 'zh' ? 'en' : 'zh');
            }}
          >
            <Text style={styles.languageToggleText}>{language === 'zh' ? 'EN' : '中文'}</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>{t('permission_title')}</Text>
        <Text style={styles.subtitle}>{t('permission_subtitle')}</Text>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t('permission_notice_title')}</Text>
          <Text style={styles.noticeBody}>{t('permission_notice_body')}</Text>
        </View>

        <View style={styles.tipsBox}>
          <Text style={styles.tipsTitle}>{t('permission_tips_title')}</Text>
          <Text style={styles.tipsText}>{t('permission_tip_camera')}</Text>
          <Text style={styles.tipsText}>{t('permission_tip_photos')}</Text>
          <Text style={styles.tipsText}>{t('permission_tip_microphone')}</Text>
        </View>

        <View style={styles.permissionList}>
          {PERMISSIONS.map((permission) => {
            const status = permissions[permission.key];
            return (
              <View key={permission.key} style={styles.permissionItem}>
                <View style={styles.permissionBody}>
                  <Text style={styles.permissionTitle}>{t(permission.titleKey)}</Text>
                  <Text style={styles.permissionDescription}>{t(permission.descriptionKey)}</Text>
                </View>
                <Text style={[styles.permissionStatus, { color: getStatusColor(status) }]}>
                  {getStatusLabel(status, language)}
                </Text>
              </View>
            );
          })}
        </View>

        {(isLoadingSnapshot || isRequesting || isPreflightingLocalNetwork) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={adaptiveColor('#38BDF8')} />
            <Text style={styles.loadingText}>
              {isLoadingSnapshot
                ? t('permission_loading_checking')
                : isPreflightingLocalNetwork
                  ? t('permission_loading_local_network')
                  : t('permission_loading_requesting')}
            </Text>
          </View>
        )}

        {!allGranted && (
          <>
            <Pressable
              style={[styles.primaryButton, (isLoadingSnapshot || isRequesting) && styles.primaryButtonDisabled]}
              disabled={isLoadingSnapshot || isRequesting}
              onPress={() => {
                void handleGrantPermissions();
              }}
            >
              <Text style={styles.primaryButtonText}>{t('permission_grant_button')}</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                router.replace(activeProfileId ? '/(tabs)/dashboard' : '/connection');
              }}
            >
              <Text style={styles.secondaryButtonText}>{t('permission_skip_button')}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = createAdaptiveStyles({
  flex: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 44,
    paddingBottom: 40,
    gap: 16,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  languageToggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  languageToggleText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  stepBadgeText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    fontSize: 34,
    color: '#F8FAFC',
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 17,
    lineHeight: 24,
  },
  tipsBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    padding: 14,
    gap: 8,
  },
  tipsTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
  },
  tipsText: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
  },
  notice: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 8,
  },
  noticeTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 16,
  },
  noticeBody: {
    color: '#DBEAFE',
    fontSize: 15,
    lineHeight: 22,
  },
  permissionList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    overflow: 'hidden',
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 68,
    gap: 10,
  },
  permissionBody: {
    flex: 1,
    gap: 5,
  },
  permissionTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionDescription: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
  },
  permissionStatus: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#93C5FD',
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: '#38BDF8',
    minHeight: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 17,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 16,
  },
});
