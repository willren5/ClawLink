import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { APP_ERROR_CODES, getAppErrorCode } from '../../../lib/errors/appError';
import { parseGatewayEndpointInput, parsePort } from '../../../lib/utils/network';
import { LiquidGlassPanel } from '../../../components/LiquidGlassPanel';
import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../store/connectionStore';
import { getVisibleGatewayProfiles, HIDDEN_DEBUG_TOKEN } from '../debugProfile';
import { useI18n } from '../../../lib/i18n';
import { parseGatewayImport, type ImportedGatewayConfig } from '../services/connectionImport';

const PROMO_DEMO_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_PROMO_DEMO === '1';

function formatConnectionErrorMessage(error: unknown, language: 'zh' | 'en'): string {
  const localized = (zh: string, en: string): string => (language === 'zh' ? zh : en);

  if (!(error instanceof Error)) {
    return localized(
      '连接失败，请检查地址、端口、Token 后重试。',
      'Connection failed. Check host, port, and token, then retry.',
    );
  }

  const errorCode = getAppErrorCode(error);
  const message = error.message;

  if (message.toLowerCase().includes('will not retry over insecure http automatically')) {
    return localized(
      'HTTPS 连接失败。为了避免把 Token 自动降级发送到不安全的 HTTP，ClawLink 不会自动回退到 HTTP。请确认网关协议后手动重试。',
      'HTTPS connection failed. To avoid resending your token over insecure HTTP, ClawLink will not auto-fallback to HTTP. Verify the gateway protocol and retry explicitly.',
    );
  }

  if (errorCode === APP_ERROR_CODES.AUTH_EXPIRED || errorCode === APP_ERROR_CODES.AUTH_FORBIDDEN) {
    return localized(
      'Token 无效或已过期，请在 OpenClaw Gateway 重新复制 Token。',
      'Token is invalid or expired. Please copy a fresh token from OpenClaw Gateway.',
    );
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_ENDPOINT_NOT_FOUND) {
    return localized(
      '未找到网关接口，请检查地址、端口和 HTTPS 开关是否正确。',
      'Gateway endpoint not found. Please verify host, port, and HTTPS toggle.',
    );
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_ORIGIN_NOT_ALLOWED) {
    return localized(
      '网关拒绝了当前客户端来源。请在网关配置里允许该来源，或切换 iOS 客户端模式后重试。',
      'Gateway rejected current client origin. Allow this origin in gateway config or retry with iOS client mode.',
    );
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED) {
    return localized(
      '当前设备需要在网关主机上先完成配对授权。',
      'This device must be approved by pairing on the gateway host first.',
    );
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_DEVICE_IDENTITY_REQUIRED) {
    return localized(
      '网关要求设备身份校验。请在网关端允许移动端接入后再连接。',
      'Gateway requires device identity verification. Allow mobile device access on gateway first.',
    );
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_UNREACHABLE) {
    return localized(
      '无法连接到网关。请检查：1) 网关已启动；2) 使用同一局域网；3) 未开启会劫持局域网的 VPN/代理；4) 网关绑定为 LAN（openclaw config set gateway.bind lan）。',
      'Cannot reach gateway. Check: 1) gateway is running; 2) same LAN/Wi-Fi; 3) VPN/proxy is not hijacking LAN traffic; 4) gateway bind is LAN (openclaw config set gateway.bind lan).',
    );
  }

  if (errorCode === APP_ERROR_CODES.TIMEOUT) {
    return localized(
      '连接超时，请检查网关是否在线，或稍后重试。',
      'Connection timed out. Check gateway status and retry later.',
    );
  }

  if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
    return localized(
      'Token 无效或已过期，请在 OpenClaw Gateway 重新复制 Token。',
      'Token is invalid or expired. Please copy a fresh token from OpenClaw Gateway.',
    );
  }

  if (message.includes('HTTP 404')) {
    return localized(
      '未找到网关接口，请检查地址、端口和 HTTPS 开关是否正确。',
      'Gateway endpoint not found. Please verify host, port, and HTTPS toggle.',
    );
  }

  if (message.includes('origin not allowed')) {
    return localized(
      '网关拒绝了当前客户端来源。请在网关配置里允许该来源，或切换 iOS 客户端模式后重试。',
      'Gateway rejected current client origin. Allow this origin in gateway config or retry with iOS client mode.',
    );
  }

  if (message.includes('PAIRING_REQUIRED')) {
    return localized(
      '当前设备需要在网关主机上先完成配对授权。',
      'This device must be approved by pairing on the gateway host first.',
    );
  }

  if (message.includes('DEVICE_IDENTITY_REQUIRED')) {
    return localized(
      '网关要求设备身份校验。请在网关端允许移动端接入后再连接。',
      'Gateway requires device identity verification. Allow mobile device access on gateway first.',
    );
  }

  const lowered = message.toLowerCase();
  if (
    lowered.includes('could not connect') ||
    lowered.includes('connection refused') ||
    lowered.includes('econnrefused') ||
    lowered.includes('err_network')
  ) {
    return localized(
      '网关拒绝连接。请先确认网关已启动并监听 LAN（不是 127.0.0.1），设备和网关在同一 Wi-Fi，且未被 VPN/代理拦截。网关主机可执行：openclaw config set gateway.bind lan && openclaw gateway restart',
      'Connection refused by gateway. Ensure gateway is running and bound to LAN (not 127.0.0.1), phone and gateway are on same Wi-Fi, and VPN/proxy is not intercepting LAN traffic. On gateway host run: openclaw config set gateway.bind lan && openclaw gateway restart',
    );
  }

  if (
    lowered.includes('http network') ||
    lowered.includes('network') ||
    lowered.includes('nsurlerrordomain') ||
    lowered.includes('-1004') ||
    lowered.includes('-1005')
  ) {
    return localized(
      '无法连接到网关。请检查：1) 网关已启动；2) 使用同一局域网；3) 未开启会劫持局域网的 VPN/代理；4) 网关绑定为 LAN（openclaw config set gateway.bind lan）。',
      'Cannot reach gateway. Check: 1) gateway is running; 2) same LAN/Wi-Fi; 3) VPN/proxy is not hijacking LAN traffic; 4) gateway bind is LAN (openclaw config set gateway.bind lan).',
    );
  }

  if (message.includes('timeout')) {
    return localized(
      '连接超时，请检查网关是否在线，或稍后重试。',
      'Connection timed out. Check gateway status and retry later.',
    );
  }

  return message;
}

export function ConnectionScreen(): JSX.Element {
  const themeMode = useThemeMode();
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{
    host?: string;
    port?: string;
    tls?: string;
    name?: string;
    importPayload?: string;
  }>();
  const connectAndSaveProfile = useConnectionStore((state) => state.connectAndSaveProfile);
  const connectionStatus = useConnectionStore((state) => state.connectionStatus);
  const profiles = useConnectionStore((state) => state.profiles);
  const lastError = useConnectionStore((state) => state.lastError);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('18789');
  const [token, setToken] = useState('');
  const [profileName, setProfileName] = useState('');
  const [useTls, setUseTls] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(true);
  const [importPayload, setImportPayload] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const lastAppliedRouteImportRef = useRef<string | null>(null);
  const promoDemoAttemptedRef = useRef(false);

  const bootstrapCommand = useMemo(
    () =>
      `HOST="$(
  ipconfig getifaddr en0 2>/dev/null ||
  ipconfig getifaddr en1 2>/dev/null ||
  hostname -I 2>/dev/null | awk '{print $1}' ||
  echo 127.0.0.1
)"
PORT="$(
  plutil -extract EnvironmentVariables.OPENCLAW_GATEWAY_PORT raw \
    ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null ||
  echo 18789
)"
TOKEN="$(
  plutil -extract EnvironmentVariables.OPENCLAW_GATEWAY_TOKEN raw \
    ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null ||
  echo '<TOKEN_NOT_FOUND>'
)"
printf "Gateway Host: %s\\nPort: %s\\nAPI Token: %s\\n" "$HOST" "$PORT" "$TOKEN"`,
    [],
  );

  const commandPanelDynamicStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255, 255, 255, 0.94)' : 'rgba(2, 6, 23, 0.72)',
      borderColor: themeMode === 'light' ? '#36515C' : '#1E293B',
    }),
    [themeMode],
  );
  const commandTitleDynamicStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#213C47' : '#E2E8F0',
    }),
    [themeMode],
  );
  const commandHintDynamicStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#334E5A' : '#CBD5E1',
    }),
    [themeMode],
  );
  const codeWrapDynamicStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? '#F4FAFC' : '#0A1426',
      borderColor: themeMode === 'light' ? '#46626E' : '#2A3E59',
    }),
    [themeMode],
  );
  const codeTextDynamicStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#17323C' : '#EAF2FF',
    }),
    [themeMode],
  );
  const tokenPanelDynamicStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? '#FFF5F8' : '#2D0B0B',
      borderColor: themeMode === 'light' ? '#A62E4C' : '#7F1D1D',
    }),
    [themeMode],
  );
  const tokenTitleDynamicStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#821B33' : '#FECACA',
    }),
    [themeMode],
  );
  const tokenBodyDynamicStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#6F172B' : '#FCA5A5',
    }),
    [themeMode],
  );
  const isConnecting = connectionStatus === 'connecting';
  const activeError = formError ?? lastError;
  const normalizedActiveError = activeError?.toLowerCase() ?? '';
  const pairingHelpVisible =
    normalizedActiveError.includes('pairing_required') ||
    normalizedActiveError.includes('配对授权') ||
    normalizedActiveError.includes('device must be approved');
  const identityHelpVisible =
    normalizedActiveError.includes('device_identity_required') ||
    normalizedActiveError.includes('设备身份') ||
    normalizedActiveError.includes('mobile device access');
  const visibleProfileCount = useMemo(() => getVisibleGatewayProfiles(profiles).length, [profiles]);

  const parsedEndpoint = useMemo(() => parseGatewayEndpointInput(host), [host]);

  const baseUrlPreview = useMemo(() => {
    if (!parsedEndpoint.host) {
      return '';
    }
    const protocol = (parsedEndpoint.tls ?? useTls) ? 'https' : 'http';
    const parsedInputPort = Number.parseInt(port || '18789', 10);
    const previewPort = parsedEndpoint.port ?? (Number.isFinite(parsedInputPort) ? parsedInputPort : 18789);
    return `${protocol}://${parsedEndpoint.host}:${previewPort}`;
  }, [parsedEndpoint.host, parsedEndpoint.port, parsedEndpoint.tls, port, useTls]);
  const secureTransportEnabled = (parsedEndpoint.tls ?? useTls) === true;

  const applyImportedConfig = useCallback(
    async (config: ImportedGatewayConfig): Promise<void> => {
      if (config.host) {
        setHost(config.host);
      }
      if (typeof config.port === 'number') {
        setPort(String(config.port));
      }
      if (typeof config.tls === 'boolean') {
        setUseTls(config.tls);
      }
      if (config.token) {
        setToken(config.token);
      }
      if (config.name) {
        setProfileName(config.name);
      }

      setShowAdvanced(Boolean(config.name || typeof config.port === 'number' || typeof config.tls === 'boolean'));
      setShowImportPanel(true);
      setFormError(null);
      setImportFeedback(
        language === 'zh'
          ? '已自动填入可识别字段，请检查后连接。'
          : 'Recognized fields have been filled. Review and connect.',
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [language],
  );

  useEffect(() => {
    const rawImport =
      typeof params.importPayload === 'string'
        ? params.importPayload
        : typeof params.host === 'string'
          ? JSON.stringify({
              host: typeof params.host === 'string' ? params.host : '',
              port: typeof params.port === 'string' ? params.port : undefined,
              tls: typeof params.tls === 'string' ? params.tls : undefined,
              name: typeof params.name === 'string' ? params.name : undefined,
            })
          : '';

    const imported = rawImport ? parseGatewayImport(rawImport) : null;
    if (!imported) {
      return;
    }

    if (lastAppliedRouteImportRef.current === rawImport) {
      return;
    }

    lastAppliedRouteImportRef.current = rawImport;
    void applyImportedConfig(imported);
  }, [applyImportedConfig, params.host, params.importPayload, params.name, params.port, params.tls]);

  useEffect(() => {
    if (
      !PROMO_DEMO_ENABLED ||
      promoDemoAttemptedRef.current ||
      visibleProfileCount > 0 ||
      connectionStatus === 'connecting'
    ) {
      return;
    }

    promoDemoAttemptedRef.current = true;
    const demoInput = {
      host: '127.0.0.1',
      port: 18789,
      token: HIDDEN_DEBUG_TOKEN,
      tls: false,
      name: 'Promo Demo Gateway',
    };

    setHost(demoInput.host);
    setPort(String(demoInput.port));
    setToken(demoInput.token);
    setProfileName(demoInput.name);
    setUseTls(demoInput.tls);
    setFormError(null);
    setImportFeedback(language === 'zh' ? '正在连接本地 Demo Gateway…' : 'Connecting to local demo gateway...');

    // Dev-only shortcut for simulator promo capture.
    void connectAndSaveProfile(demoInput)
      .then(() => {
        router.replace('/(tabs)/dashboard');
      })
      .catch((error: unknown) => {
        setImportFeedback(null);
        setFormError(formatConnectionErrorMessage(error, language));
      });
  }, [connectAndSaveProfile, connectionStatus, language, router, visibleProfileCount]);

  const handleImportPayload = async (): Promise<void> => {
    setImportFeedback(null);
    const imported = parseGatewayImport(importPayload);
    if (!imported || !imported.host) {
      setImportFeedback(
        language === 'zh'
          ? '没有识别到可导入的 Host / Port。请粘贴终端输出、连接链接或 JSON。'
          : 'No importable host or port was detected. Paste terminal output, a connection link, or JSON.',
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    await applyImportedConfig(imported);
  };

  const handleConnect = async (): Promise<void> => {
    setFormError(null);
    setImportFeedback(null);
    const normalizedToken = token.trim().replace(/^['"<\s]+|['">\s]+$/g, '');

    if (!parsedEndpoint.host) {
      setFormError(language === 'zh' ? '请填写网关地址（IP 或域名）。' : 'Please enter gateway host (IP or domain).');
      return;
    }

    if (!normalizedToken) {
      setFormError(language === 'zh' ? '请填写 API Token。' : 'Please enter API token.');
      return;
    }

    let parsedPort: number;
    try {
      parsedPort = parsedEndpoint.port ?? parsePort(port);
    } catch (error: unknown) {
      setFormError(
        error instanceof Error
          ? error.message
          : language === 'zh'
            ? '端口格式不正确，请填写数字端口。'
            : 'Invalid port. Please enter a numeric port.',
      );
      return;
    }

    const resolvedTls = parsedEndpoint.tls ?? useTls;

    try {
      await connectAndSaveProfile({
        name: profileName.trim() || undefined,
        host: parsedEndpoint.host,
        port: parsedPort,
        tls: resolvedTls,
        token: normalizedToken,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/dashboard');
    } catch (error: unknown) {
      const message = formatConnectionErrorMessage(error, language);
      setFormError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
            <Text style={styles.stepBadgeText}>{t('connection_step')}</Text>
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

        <Text style={styles.title}>{t('connection_title')}</Text>
        <Text style={styles.subtitle}>{t('connection_subtitle')}</Text>

        <LiquidGlassPanel style={styles.importPanel}>
          <View style={styles.importHeader}>
            <View style={styles.importTitleWrap}>
              <Text style={styles.importTitle}>{language === 'zh' ? '智能导入' : 'Smart Import'}</Text>
              <Text style={styles.importHint}>
                {language === 'zh'
                  ? '支持粘贴网关主机终端输出、另一台设备分享的连接包、clawlink://connect 链接或 JSON。'
                  : 'Paste gateway terminal output, a shared connection bundle, a clawlink://connect link, or JSON to fill the form.'}
              </Text>
            </View>
            <Pressable
              style={styles.importToggle}
              onPress={() => {
                setShowImportPanel((value) => !value);
              }}
            >
              <Text style={styles.importToggleText}>
                {showImportPanel ? (language === 'zh' ? '收起' : 'Hide') : language === 'zh' ? '展开' : 'Open'}
              </Text>
            </Pressable>
          </View>

          {showImportPanel && (
            <View style={styles.importBody}>
              <TextInput
                value={importPayload}
                onChangeText={setImportPayload}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={
                  language === 'zh'
                    ? '例如：Gateway Host: 192.168.1.8\\nPort: 18789\\nAPI Token: ...'
                    : 'Example: Gateway Host: 192.168.1.8\\nPort: 18789\\nAPI Token: ...'
                }
                placeholderTextColor="#6B7280"
                style={styles.importInput}
              />
              {!!importFeedback && <Text style={styles.importFeedback}>{importFeedback}</Text>}
              <Text style={styles.importHintText}>
                {language === 'zh'
                  ? '小技巧：另一台设备分享过来的文本，直接整段粘贴到这里即可自动识别 Host / Port / TLS / Token。'
                  : 'Tip: if another device shared a setup bundle, paste the whole block here and ClawLink will extract host, port, TLS, and token automatically.'}
              </Text>
              <Pressable
                style={styles.importButton}
                onPress={() => {
                  void handleImportPayload();
                }}
              >
                <Text style={styles.importButtonText}>{language === 'zh' ? '解析并填充' : 'Parse & Fill'}</Text>
              </Pressable>
            </View>
          )}
        </LiquidGlassPanel>

        <LiquidGlassPanel style={styles.primarySetupPanel}>
          <Text style={styles.primarySetupTitle}>{language === 'zh' ? '快速连接' : 'Quick Connect'}</Text>
          <Text style={styles.primarySetupHint}>
            {language === 'zh' ? '默认只填必需项，30 秒内完成连接。' : 'Fill only required fields and connect in seconds.'}
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('connection_host_label')}</Text>
            <TextInput
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('connection_host_placeholder')}
              placeholderTextColor="#6B7280"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('connection_token_label')}</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder={t('connection_token_placeholder')}
              placeholderTextColor="#6B7280"
              style={styles.input}
            />
          </View>

          <Pressable
            style={styles.advancedToggle}
            onPress={() => {
              setShowAdvanced((value) => !value);
            }}
          >
            <Text style={styles.advancedToggleText}>
              {showAdvanced
                ? language === 'zh'
                  ? '收起高级设置'
                  : 'Hide advanced settings'
                : language === 'zh'
                  ? '展开高级设置（端口 / TLS / 备注）'
                  : 'Show advanced settings (port / TLS / profile)'}
            </Text>
          </Pressable>

          {showAdvanced && (
            <View style={styles.advancedFieldsBlock}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{t('connection_profile_label')}</Text>
                <TextInput
                  value={profileName}
                  onChangeText={setProfileName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('connection_profile_placeholder')}
                  placeholderTextColor="#6B7280"
                  style={styles.input}
                />
              </View>

              <View style={styles.inlineRow}>
                <View style={[styles.fieldGroup, styles.portField]}>
                  <Text style={styles.label}>{t('connection_port_label')}</Text>
                  <TextInput
                    value={port}
                    onChangeText={setPort}
                    keyboardType="number-pad"
                    placeholder="18789"
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                  />
                </View>

                <View style={[styles.fieldGroup, styles.switchField]}>
                  <Text style={styles.label}>{t('connection_tls_label')}</Text>
                  <View style={styles.switchWrap}>
                    <Text style={styles.switchValue}>{useTls ? t('connection_tls_on') : t('connection_tls_off')}</Text>
                    <Switch
                      value={useTls}
                      onValueChange={setUseTls}
                      trackColor={{
                        false: mapColorForMode('#374151', themeMode),
                        true: mapColorForMode('#2563EB', themeMode),
                      }}
                      thumbColor={mapColorForMode('#FFFFFF', themeMode)}
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {!!baseUrlPreview && (
            <LiquidGlassPanel style={styles.previewBox}>
              <Text style={styles.previewLabel}>{t('connection_preview_label')}</Text>
              <Text style={styles.previewValue}>{baseUrlPreview}</Text>
            </LiquidGlassPanel>
          )}

          {secureTransportEnabled && (
            <LiquidGlassPanel style={styles.securityNoticeBox}>
              <Text style={styles.securityNoticeTitle}>
                {language === 'zh' ? 'HTTPS 安全策略' : 'HTTPS Safety Policy'}
              </Text>
              <Text style={styles.securityNoticeText}>
                {language === 'zh'
                  ? '当你选择 HTTPS 时，ClawLink 不会为了“试试看”自动回退到 HTTP，避免把 Token 降级发送到明文链路。'
                  : 'When HTTPS is selected, ClawLink will not automatically fall back to HTTP just to test connectivity, which avoids downgrading your token onto a plaintext link.'}
              </Text>
            </LiquidGlassPanel>
          )}

          {!!activeError && <Text style={styles.errorText}>{activeError}</Text>}

          {(pairingHelpVisible || identityHelpVisible) && (
            <LiquidGlassPanel style={styles.pairingPanel}>
              <Text style={styles.pairingTitle}>
                {pairingHelpVisible
                  ? language === 'zh'
                    ? '还差一步：在网关主机上批准这台设备'
                    : 'One step left: approve this device on the gateway host'
                  : language === 'zh'
                    ? '需要在网关端开启移动设备访问'
                    : 'Enable mobile-device access on the gateway first'}
              </Text>
              <Text style={styles.pairingText}>
                {pairingHelpVisible
                  ? language === 'zh'
                    ? '1. 在网关主机上打开配对 / 审批界面或相关日志。'
                    : '1. Open the gateway host approval or pairing view and inspect pending device requests.'
                  : language === 'zh'
                    ? '1. 在网关配置里确认当前 iPhone 被允许接入。'
                    : '1. Confirm this iPhone is allowed by the gateway mobile-device policy.'}
              </Text>
              <Text style={styles.pairingText}>
                {pairingHelpVisible
                  ? language === 'zh'
                    ? '2. 找到当前手机的待批准记录并完成授权。'
                    : '2. Locate this phone in the pending devices list and approve it.'
                  : language === 'zh'
                    ? '2. 若网关有设备身份校验，请先完成设备注册。'
                    : '2. If device identity verification is enabled, register this device first.'}
              </Text>
              <Text style={styles.pairingText}>
                {language === 'zh'
                  ? '3. 回到这里重新点击 Connect；若仍失败，再展开下方帮助面板核对 Host / Token / TLS。'
                  : '3. Return here and retry Connect. If it still fails, expand the help panel below and verify host, token, and TLS.'}
              </Text>
            </LiquidGlassPanel>
          )}

          <Pressable
            style={[styles.connectButton, isConnecting && styles.connectButtonDisabled]}
            onPress={() => {
              void handleConnect();
            }}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color={mapColorForMode('#0F172A', themeMode)} />
            ) : (
              <Text style={styles.connectButtonText}>{t('connection_connect_button')}</Text>
            )}
          </Pressable>

          <Text style={styles.helperText}>{t('connection_connected_hint')}</Text>

          <Pressable
            style={styles.profilesButton}
            onPress={() => {
              router.push('/settings/gateways');
            }}
          >
            <Text style={styles.profilesButtonText}>
              {t('connection_saved_gateways')}（{visibleProfileCount}/5）
            </Text>
          </Pressable>
        </LiquidGlassPanel>

        <Pressable
          style={[styles.helpToggle, showHelpPanel && styles.helpToggleActive]}
          onPress={() => {
            setShowHelpPanel((value) => !value);
          }}
        >
          <Text style={[styles.helpToggleText, showHelpPanel && styles.helpToggleTextActive]}>
            {showHelpPanel
              ? language === 'zh'
                ? '收起连接帮助'
                : 'Hide connection help'
              : language === 'zh'
                ? '需要帮助？展开连接参考与安全提示'
                : 'Need help? Show connection guide and security tips'}
          </Text>
        </Pressable>

        {showHelpPanel && (
          <>
            <LiquidGlassPanel style={styles.guideBox}>
              <Text style={styles.guideTitle}>{t('connection_guide_title')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_1')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_2')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_3')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_4')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_5')}</Text>
              <Text style={styles.guideText}>{t('connection_guide_6')}</Text>
            </LiquidGlassPanel>

            <LiquidGlassPanel style={[styles.commandPanel, commandPanelDynamicStyle]}>
              <Text style={[styles.commandTitle, commandTitleDynamicStyle]}>{t('connection_bootstrap_title')}</Text>
              <Text style={[styles.commandHint, commandHintDynamicStyle]}>{t('connection_bootstrap_hint')}</Text>
              <View style={[styles.commandCodeWrap, codeWrapDynamicStyle]}>
                <Text selectable style={[styles.commandCode, codeTextDynamicStyle]}>
                  {bootstrapCommand}
                </Text>
              </View>
            </LiquidGlassPanel>
            <LiquidGlassPanel style={[styles.tokenSecurityPanel, tokenPanelDynamicStyle]}>
              <Text style={[styles.tokenSecurityTitle, tokenTitleDynamicStyle]}>{t('connection_token_security_title')}</Text>
              <Text style={[styles.tokenSecurityBody, tokenBodyDynamicStyle]}>{t('connection_token_security_body')}</Text>
              <Text style={[styles.tokenSecurityBody, tokenBodyDynamicStyle]}>
                {language === 'zh'
                  ? '建议：优先使用短期 Token；不同设备使用不同 Token；每次分享屏幕前先隐藏 Token。'
                  : 'Best practice: use short-lived tokens, one token per device, and hide token before screen sharing.'}
              </Text>
            </LiquidGlassPanel>
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
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: 17,
    color: '#94A3B8',
    lineHeight: 25,
  },
  primarySetupPanel: {
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  primarySetupTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 22,
  },
  importPanel: {
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  importHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  importTitleWrap: {
    flex: 1,
    gap: 4,
  },
  importTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 18,
  },
  importHint: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 21,
  },
  importToggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  importToggleText: {
    color: '#BFDBFE',
    fontSize: 13,
    fontWeight: '700',
  },
  importBody: {
    gap: 10,
  },
  importInput: {
    minHeight: 130,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  importFeedback: {
    color: '#93C5FD',
    fontSize: 13,
    lineHeight: 19,
  },
  importHintText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  importButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonText: {
    color: '#EFF6FF',
    fontSize: 14,
    fontWeight: '700',
  },
  primarySetupHint: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
  },
  advancedToggle: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  advancedToggleText: {
    color: '#BFDBFE',
    fontSize: 14,
    fontWeight: '600',
  },
  advancedFieldsBlock: {
    gap: 12,
  },
  guideBox: {
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  guideTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 17,
  },
  guideText: {
    color: '#E2E8F0',
    fontSize: 15,
    lineHeight: 22,
  },
  commandPanel: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  commandTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 17,
  },
  commandHint: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 21,
  },
  commandCodeWrap: {
    marginTop: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  commandCode: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  tokenSecurityPanel: {
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
  },
  pairingPanel: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(59, 7, 100, 0.28)',
  },
  pairingTitle: {
    color: '#F5D0FE',
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 22,
  },
  pairingText: {
    color: '#E9D5FF',
    fontSize: 14,
    lineHeight: 21,
  },
  tokenSecurityTitle: {
    fontWeight: '700',
    fontSize: 17,
  },
  tokenSecurityBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  fieldGroup: {
    gap: 8,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  portField: {
    flex: 0.45,
  },
  switchField: {
    flex: 0.55,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    borderRadius: 12,
    height: 54,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  switchWrap: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0F172A',
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  switchValue: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
  },
  previewBox: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  previewLabel: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '600',
  },
  previewValue: {
    color: '#DBEAFE',
    fontSize: 15,
  },
  securityNoticeBox: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#0F766E',
    backgroundColor: 'rgba(6, 78, 59, 0.22)',
  },
  securityNoticeTitle: {
    color: '#99F6E4',
    fontSize: 14,
    fontWeight: '700',
  },
  securityNoticeText: {
    color: '#CCFBF1',
    fontSize: 13,
    lineHeight: 20,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 15,
    lineHeight: 22,
  },
  connectButton: {
    marginTop: 8,
    backgroundColor: '#38BDF8',
    minHeight: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectButtonDisabled: {
    opacity: 0.65,
  },
  connectButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 17,
  },
  helperText: {
    color: '#93C5FD',
    fontSize: 14,
    textAlign: 'center',
  },
  profilesButton: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  profilesButtonText: {
    color: '#60A5FA',
    fontSize: 15,
    fontWeight: '600',
  },
  helpToggle: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  helpToggleActive: {
    borderColor: '#2563EB',
    backgroundColor: '#10223E',
  },
  helpToggleText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  helpToggleTextActive: {
    color: '#DBEAFE',
  },
});
