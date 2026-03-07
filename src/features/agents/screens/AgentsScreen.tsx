import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { APP_ERROR_CODES, type AppErrorCode } from '../../../lib/errors/appError';
import { isExperimentalFeatureEnabled } from '../../../lib/features/featureFlags';
import { adaptiveColor, createAdaptiveStyles } from '../../../theme/adaptiveStyles';
import { useAgentsControl } from '../hooks/useAgentsControl';
import { useSkillManager } from '../hooks/useSkillManager';
import { useI18n, type I18nKey } from '../../../lib/i18n';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import type { AgentListItem } from '../types';
import type { SecurityFinding, SecurityPermission } from '../../security/scanner';
import type { SkillScanProgress, SkillSecurityReport } from '../types/skills';

function statusColor(status: AgentListItem['status']): string {
  switch (status) {
    case 'active':
      return '#10B981';
    case 'idle':
      return '#60A5FA';
    case 'error':
      return '#F87171';
    case 'disabled':
      return '#94A3B8';
    default:
      return '#94A3B8';
  }
}

function severityColor(severity: SecurityFinding['severity']): string {
  switch (severity) {
    case 'CRITICAL':
      return '#F87171';
    case 'WARNING':
      return '#FBBF24';
    case 'INFO':
      return '#60A5FA';
    default:
      return '#94A3B8';
  }
}

function permissionLabel(permission: SecurityPermission, language: 'zh' | 'en'): string {
  switch (permission) {
    case 'network_access':
      return language === 'zh' ? '网络访问' : 'Network';
    case 'command_execution':
      return language === 'zh' ? '命令执行' : 'Exec';
    case 'package_installation':
      return language === 'zh' ? '安装依赖' : 'Packages';
    case 'file_system_write':
      return language === 'zh' ? '文件系统写入' : 'Filesystem';
    case 'secret_material':
      return language === 'zh' ? '敏感内容' : 'Secrets';
    default:
      return permission;
  }
}

function scanStageLabel(stage: SkillScanProgress['stage'], t: (key: I18nKey) => string): string {
  switch (stage) {
    case 'metadata':
      return t('agents_scan_stage_metadata');
    case 'collecting':
      return t('agents_scan_stage_collecting');
    case 'fetching':
      return t('agents_scan_stage_fetching');
    case 'scanning':
      return t('agents_scan_stage_scanning');
    case 'completed':
      return t('agents_scan_stage_done');
    default:
      return t('agents_scan_stage_idle');
  }
}

function reportRiskMeta(report: SkillSecurityReport, t: (key: I18nKey) => string): { label: string; color: string } {
  if (report.scan.critical > 0) {
    return { label: t('agents_risk_high'), color: '#F87171' };
  }

  if (report.scan.warning > 0) {
    return { label: t('agents_risk_review_needed'), color: '#FBBF24' };
  }

  return { label: t('agents_risk_low'), color: '#34D399' };
}

function formatCreateAgentError(
  errorMessage: string | undefined,
  errorCode: AppErrorCode | undefined,
  t: (key: I18nKey) => string,
): string {
  if (errorCode === APP_ERROR_CODES.AUTH_EXPIRED || errorCode === APP_ERROR_CODES.AUTH_FORBIDDEN) {
    return t('agents_error_create_failed_permission');
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED || errorCode === APP_ERROR_CODES.GATEWAY_DEVICE_IDENTITY_REQUIRED) {
    return t('agents_error_create_failed_pairing');
  }

  if (errorCode === APP_ERROR_CODES.REQUEST_INVALID || errorCode === APP_ERROR_CODES.RESPONSE_SCHEMA_INVALID) {
    return t('agents_error_create_failed_schema');
  }

  if (errorCode === APP_ERROR_CODES.GATEWAY_ORIGIN_NOT_ALLOWED) {
    return t('agents_error_create_failed_origin');
  }

  const normalized = (errorMessage ?? '').toLowerCase();

  if (
    normalized.includes('already exists') ||
    normalized.includes('duplicate') ||
    normalized.includes('name already exists')
  ) {
    return t('agents_error_duplicate_name_body');
  }

  if (normalized.includes('reserved')) {
    return t('agents_error_invalid_name_body');
  }

  if (
    normalized.includes('permission') ||
    normalized.includes('read-only') ||
    normalized.includes('readonly') ||
    normalized.includes('insufficient_scope') ||
    normalized.includes('forbidden') ||
    normalized.includes('not allowed') ||
    normalized.includes('http 401') ||
    normalized.includes('http 403')
  ) {
    return t('agents_error_create_failed_permission');
  }

  if (normalized.includes('pairing_required') || normalized.includes('device_identity_required')) {
    return t('agents_error_create_failed_pairing');
  }

  if (
    normalized.includes('invalid_request') ||
    normalized.includes('unexpected property') ||
    normalized.includes('schema') ||
    normalized.includes('invalid input')
  ) {
    return t('agents_error_create_failed_schema');
  }

  if (normalized.includes('origin not allowed')) {
    return t('agents_error_create_failed_origin');
  }

  if (normalized.includes('rejected') || normalized.includes('reject')) {
    const compactMessage = (errorMessage ?? '').trim();
    if (!compactMessage) {
      return t('agents_error_create_failed_rejected');
    }

    return `${t('agents_error_create_failed_rejected')} (${compactMessage})`;
  }

  if (!normalized.trim()) {
    return t('agents_error_create_failed_default');
  }

  return errorMessage as string;
}

function AgentCard(props: {
  item: AgentListItem;
  onToggle: (agentId: string, enable: boolean) => void;
  onRestart: (agentId: string) => void;
  onKill: (agentId: string) => void;
  onLogs: (agentId: string) => void;
}): JSX.Element {
  const { t, language } = useI18n();
  const color = statusColor(props.item.status);
  const isEnabled = props.item.status !== 'disabled';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.statusWrap}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.status, { color }]}>{props.item.status.toUpperCase()}</Text>
        </View>
        <Text style={styles.model}>{props.item.model ?? t('agents_unknown_model')}</Text>
      </View>

      <Text style={styles.name}>{props.item.name}</Text>
      <Text style={styles.meta}>{t('agents_conversation_count')}: {props.item.conversationCount ?? 0}</Text>
      <Text style={styles.meta}>
        {t('agents_last_active')}:{' '}
        {props.item.lastActiveAt ? new Date(props.item.lastActiveAt).toLocaleString() : t('agents_no_activity_yet')}
      </Text>

      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.action, styles.actionPrimary]}
          onPress={() => {
            props.onToggle(props.item.id, !isEnabled);
          }}
        >
          <Text style={styles.actionPrimaryText}>{isEnabled ? t('agents_action_disable') : t('agents_action_enable')}</Text>
        </Pressable>

        <Pressable
          style={[styles.action, styles.actionSecondary]}
          onPress={() => {
            props.onRestart(props.item.id);
          }}
        >
          <Text style={styles.actionSecondaryText}>{t('agents_action_restart')}</Text>
        </Pressable>

        <Pressable
          style={[styles.action, styles.actionDanger]}
          onPress={() => {
            props.onKill(props.item.id);
          }}
        >
          <Text style={styles.actionDangerText}>{t('agents_action_kill')}</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.logsButton}
        onPress={() => {
          props.onLogs(props.item.id);
        }}
      >
        <Text style={styles.logsButtonText}>{t('agents_logs_view_last_100')}</Text>
      </Pressable>
    </View>
  );
}

function CreateAgentModal(props: {
  visible: boolean;
  creating: boolean;
  name: string;
  model: string;
  systemPrompt: string;
  onChangeName: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeSystemPrompt: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}): JSX.Element {
  const { t, language } = useI18n();

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.createOverlay}>
        <View style={styles.createSheet}>
          <Text style={styles.createTitle}>{t('agents_create_modal_title')}</Text>
          <Text style={styles.createSubtitle}>{t('agents_create_modal_subtitle')}</Text>

          <Text style={styles.createLabel}>{t('agents_create_name_label')}</Text>
          <TextInput
            value={props.name}
            onChangeText={props.onChangeName}
            placeholder={t('agents_create_name_placeholder')}
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.createInput}
          />

          <Text style={styles.createLabel}>{t('agents_create_model_label')}</Text>
          <TextInput
            value={props.model}
            onChangeText={props.onChangeModel}
            placeholder={t('agents_create_model_placeholder')}
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.createInput}
          />

          <Text style={styles.createLabel}>{t('agents_create_prompt_label')}</Text>
          <TextInput
            value={props.systemPrompt}
            onChangeText={props.onChangeSystemPrompt}
            placeholder={t('agents_create_prompt_placeholder')}
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[styles.createInput, styles.createPromptInput]}
          />

          <View style={styles.createActions}>
            <Pressable style={[styles.createAction, styles.createCancel]} onPress={props.onClose}>
              <Text style={styles.createCancelText}>{t('common_cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.createAction, styles.createConfirm, props.creating && styles.actionDisabled]}
              disabled={props.creating}
              onPress={props.onSubmit}
            >
              {props.creating ? (
                <ActivityIndicator color={adaptiveColor('#DBEAFE')} />
              ) : (
                <Text style={styles.createConfirmText}>{t('common_create')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SecurityReportModal(props: {
  visible: boolean;
  report: SkillSecurityReport | null;
  approved: boolean;
  installing: boolean;
  onClose: () => void;
  onApprove: () => void;
  onInstall: () => void;
}): JSX.Element {
  const { t, language } = useI18n();
  const riskMeta = props.report ? reportRiskMeta(props.report, t) : null;
  const approveLabel = props.report
    ? props.report.scan.critical > 0
      ? `${t('agents_security_ack_critical_prefix')} ${props.report.scan.critical} ${t('agents_security_ack_critical_suffix')}`
      : t('agents_security_proceed_install')
    : t('agents_security_proceed_install');

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.reportScreen}>
        <View style={styles.reportHeader}>
          <Text style={styles.reportTitle}>{t('agents_security_report_title')}</Text>
          <Pressable style={styles.reportCloseButton} onPress={props.onClose}>
            <Text style={styles.reportCloseButtonText}>{t('common_close')}</Text>
          </Pressable>
        </View>

        {!props.report ? (
          <View style={styles.reportEmpty}>
            <Text style={styles.reportEmptyText}>{t('agents_security_report_empty')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.reportSummary}>
              <Text style={styles.reportSummaryTitle}>
                {props.report.skillName}
                {props.report.version ? ` @ ${props.report.version}` : ''}
              </Text>
              {!!riskMeta && (
                <View style={styles.riskBadge}>
                  <Text style={[styles.riskBadgeText, { color: riskMeta.color }]}>{riskMeta.label}</Text>
                </View>
              )}
              <Text style={styles.reportSummaryText}>{t('agents_security_total_items')}: {props.report.scan.total}</Text>
              <Text style={styles.reportSummaryText}>{t('agents_security_critical')}: {props.report.scan.critical}</Text>
              <Text style={styles.reportSummaryText}>{t('agents_security_warning')}: {props.report.scan.warning}</Text>
              <Text style={styles.reportSummaryText}>{t('agents_security_info')}: {props.report.scan.info}</Text>
              <Text style={styles.reportSummaryText}>{t('agents_security_scanned_files')}: {props.report.targets.length}</Text>
              <Text style={styles.reportSummaryText}>
                {t('agents_security_source_fetched')}: {props.report.sourceSummary.fetchedUrls.length} / {t('agents_security_source_failed')}:{' '}
                {props.report.sourceSummary.failedUrls.length}
              </Text>
              <Text style={styles.reportSummaryText}>
                {t('agents_security_blocked_refs')}: {props.report.sourceSummary.blockedReferences.length}
              </Text>
              {props.report.scan.permissions.length > 0 && (
                <View style={styles.permissionSummary}>
                  {props.report.scan.permissions.map((permission) => (
                    <View key={permission} style={styles.permissionChip}>
                      <Text style={styles.permissionChipText}>{permissionLabel(permission, language)}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Text style={styles.reportSummaryText}>
                {t('agents_security_generated_at')}: {new Date(props.report.generatedAt).toLocaleString()}
              </Text>
              {!!props.report.sourceSummary.repositoryUrl && (
                <Text style={styles.reportSummaryText} numberOfLines={1}>
                  {t('agents_security_repo')}: {props.report.sourceSummary.repositoryUrl}
                </Text>
              )}
            </View>

            <View style={styles.reportTargetsPanel}>
              <Text style={styles.reportTargetsTitle}>{t('agents_security_scanned_targets')}</Text>
              {props.report.targets.map((target, index) => (
                <Text key={`${target.filePath}:${index}`} style={styles.reportTargetItem} numberOfLines={1}>
                  • {target.filePath}
                </Text>
              ))}
            </View>

            <FlatList
              data={props.report.scan.findings}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.reportFindingsList}
              renderItem={({ item }) => (
                <View style={styles.findingCard}>
                  <View style={styles.findingHeader}>
                    <Text style={[styles.findingSeverity, { color: severityColor(item.severity) }]}>
                      {item.severity}
                    </Text>
                    <Text style={styles.findingType}>{item.type}</Text>
                  </View>
                  <Text style={styles.findingPath}>
                    {item.filePath}:{item.line}
                  </Text>
                  <Text style={styles.findingMatch}>{item.match}</Text>
                  <View style={styles.contextBox}>
                    {item.context.map((line, index) => (
                      <Text key={`${item.id}:ctx:${index}`} style={styles.contextLine}>
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.findingCard}>
                  <Text style={styles.reportSummaryText}>{t('agents_security_no_findings')}</Text>
                </View>
              }
            />

            <View style={styles.reportActions}>
              <Pressable
                style={[styles.reportAction, styles.reportActionApprove, props.approved && styles.reportActionDisabled]}
                disabled={props.approved}
                onPress={props.onApprove}
              >
                <Text style={styles.reportActionText}>{props.approved ? t('agents_security_review_completed') : approveLabel}</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.reportAction,
                  styles.reportActionInstall,
                  (!props.approved || props.installing) && styles.reportActionDisabled,
                ]}
                disabled={!props.approved || props.installing}
                onPress={props.onInstall}
              >
                {props.installing ? (
                  <ActivityIndicator color={adaptiveColor('#DBEAFE')} />
                ) : (
                  <Text style={styles.reportActionText}>{t('agents_security_confirm_install')}</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

export function AgentsScreen(): JSX.Element {
  const { t, language } = useI18n();
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const [activePane, setActivePane] = useState<'agents' | 'skills'>('agents');
  const [skillInput, setSkillInput] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [creatingAgent, setCreatingAgent] = useState(false);

  const {
    agents,
    loading,
    refreshing,
    error,
    selectedAgentId,
    selectedAgentLogs,
    logsHasMore,
    logsLoading,
    refresh,
    createOneAgent,
    toggleAgentStatus,
    restartOneAgent,
    killOneAgent,
    loadAgentLogs,
    loadMoreAgentLogs,
  } = useAgentsControl();
  const agentLogPaginationEnabled = useMemo(
    () => isExperimentalFeatureEnabled('agentLogsPagination', featureOverrides),
    [featureOverrides],
  );

  const {
    skills,
    loading: skillsLoading,
    refreshing: skillsRefreshing,
    scanLoading,
    installing,
    uninstallingSkill,
    error: skillError,
    report,
    reportApproved,
    scanProgress,
    refreshSkills,
    generateReport,
    approveReport,
    installApprovedSkill,
    closeReport,
    uninstallOneSkill,
  } = useSkillManager({
    onSkillChanged: refresh,
  });

  const selectedAgentName = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId)?.name ?? t('agents_no_agent_selected'),
    [agents, selectedAgentId, t],
  );

  const installFlowStep = useMemo(() => {
    if (installing) {
      return 4;
    }

    if (reportApproved) {
      return 3;
    }

    if (report) {
      return 2;
    }

    if (scanLoading || scanProgress) {
      return 1;
    }

    return 0;
  }, [installing, reportApproved, report, scanLoading, scanProgress]);

  const handleSubmitCreateAgent = async (): Promise<void> => {
    const normalizedName = createName.trim();
    const normalizedModel = createModel.trim();

    if (!normalizedName) {
      Alert.alert(t('agents_error_missing_fields_title'), t('agents_error_missing_fields_body'));
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(normalizedName)) {
      Alert.alert(t('agents_error_invalid_name_title'), t('agents_error_invalid_name_body'));
      return;
    }

    const duplicated = agents.some(
      (agent) => agent.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );
    if (duplicated) {
      Alert.alert(t('agents_error_duplicate_name_title'), t('agents_error_duplicate_name_body'));
      return;
    }

    setCreatingAgent(true);
    try {
      const result = await createOneAgent({
        name: normalizedName,
        model: normalizedModel || undefined,
        systemPrompt: createPrompt.trim() || undefined,
      });

      if (!result.ok) {
        Alert.alert(
          t('agents_error_create_failed_title'),
          formatCreateAgentError(result.error, result.errorCode, t),
        );
        return;
      }

      setCreateModalVisible(false);
      setCreateName('');
      setCreatePrompt('');
      Alert.alert(
        t('agents_success_created_title'),
        result.message?.trim() ? result.message : `${normalizedName} · ${t('agents_success_created_body')}`,
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topHeader, styles.contentMaxWidth]}>
        <Text style={styles.title}>{t('agents_screen_title')}</Text>
        <Text style={styles.subtitle}>{t('agents_screen_subtitle')}</Text>

        {activePane === 'agents' && (
          <Pressable
            style={styles.createAgentButton}
            onPress={() => {
              setCreateModalVisible(true);
            }}
          >
            <Text style={styles.createAgentButtonText}>{t('agents_create_button')}</Text>
          </Pressable>
        )}

        <View style={styles.paneRow}>
          <Pressable
            style={[styles.paneChip, activePane === 'agents' && styles.paneChipActive]}
            onPress={() => {
              setActivePane('agents');
            }}
          >
            <Text style={[styles.paneChipText, activePane === 'agents' && styles.paneChipTextActive]}>
              {t('agents_pane_agents')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.paneChip, activePane === 'skills' && styles.paneChipActive]}
            onPress={() => {
              setActivePane('skills');
            }}
          >
            <Text style={[styles.paneChipText, activePane === 'skills' && styles.paneChipTextActive]}>
              {t('agents_pane_skills')}
            </Text>
          </Pressable>
        </View>

        {!!error && activePane === 'agents' && <Text style={styles.error}>{error}</Text>}
        {!!skillError && activePane === 'skills' && <Text style={styles.error}>{skillError}</Text>}
      </View>

      {activePane === 'agents' ? (
        loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={adaptiveColor('#38BDF8')} />
          </View>
        ) : (
          <FlatList
            data={agents}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, styles.contentMaxWidth]}
            refreshControl={
              <RefreshControl tintColor={adaptiveColor('#38BDF8')} refreshing={refreshing} onRefresh={() => void refresh()} />
            }
            renderItem={({ item }) => (
              <AgentCard
                item={item}
                onToggle={(agentId, enable) => {
                  void toggleAgentStatus(agentId, enable);
                }}
                onRestart={(agentId) => {
                  void restartOneAgent(agentId);
                }}
                onKill={(agentId) => {
                  Alert.alert(t('agents_kill_confirm_title'), t('agents_kill_confirm_body'), [
                    { text: t('agents_action_cancel'), style: 'cancel' },
                    {
                      text: t('agents_action_kill'),
                      style: 'destructive',
                      onPress: () => {
                        void killOneAgent(agentId);
                      },
                    },
                  ]);
                }}
                onLogs={(agentId) => {
                  void loadAgentLogs(agentId);
                  setLogsModalVisible(true);
                }}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>{t('agents_empty_title')}</Text>
                <Text style={styles.emptyText}>{t('agents_empty_body')}</Text>
              </View>
            }
            ListFooterComponent={
              <View style={styles.logsPanel}>
                <Text style={styles.logsTitle}>
                  {t('agents_logs_title_prefix')}: {selectedAgentName}
                </Text>
                {logsLoading ? (
                  <ActivityIndicator color={adaptiveColor('#38BDF8')} />
                ) : (
                  <ScrollView
                    style={styles.logsScroll}
                    contentContainerStyle={styles.logsContent}
                    nestedScrollEnabled
                  >
                    {selectedAgentLogs.length === 0 ? (
                      <Text style={styles.logTextMuted}>{t('agents_logs_hint')}</Text>
                    ) : (
                      selectedAgentLogs.map((line, index) => (
                        <Text key={`${index}:${line}`} style={styles.logText}>
                          {line}
                        </Text>
                      ))
                    )}
                  </ScrollView>
                )}
                {agentLogPaginationEnabled && logsHasMore && !logsLoading && (
                  <Pressable
                    style={styles.logsLoadMoreButton}
                    onPress={() => {
                      void loadMoreAgentLogs();
                    }}
                  >
                    <Text style={styles.logsLoadMoreText}>
                      {language === 'zh' ? '再加载 100 条更早日志' : 'Load 100 older logs'}
                    </Text>
                  </Pressable>
                )}
              </View>
            }
          />
        )
      ) : (
        <ScrollView
          style={styles.skillsScroll}
          contentContainerStyle={[styles.skillsContent, styles.contentMaxWidth]}
          refreshControl={
            <RefreshControl
              tintColor={adaptiveColor('#38BDF8')}
              refreshing={skillsRefreshing || skillsLoading}
              onRefresh={() => void refreshSkills()}
            />
          }
        >
          <View style={styles.card}>
            <Text style={styles.name}>{t('agents_install_skill_title')}</Text>
            <Text style={styles.meta}>{t('agents_install_skill_subtitle')}</Text>

            <View style={styles.flowRow}>
              {[
                { step: 1, label: t('agents_install_step_scan') },
                { step: 2, label: t('agents_install_step_report') },
                { step: 3, label: t('agents_install_step_approve') },
                { step: 4, label: t('agents_install_step_install') },
              ].map((item) => {
                const active = installFlowStep >= item.step;
                return (
                  <View key={item.step} style={[styles.flowChip, active && styles.flowChipActive]}>
                    <Text style={[styles.flowChipText, active && styles.flowChipTextActive]}>
                      {item.step}. {item.label}
                    </Text>
                  </View>
                );
              })}
            </View>

            <TextInput
              value={skillInput}
              onChangeText={setSkillInput}
              placeholder="e.g. gateway-sync-tool"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.skillInput}
            />

            <Pressable
              style={[styles.action, styles.actionPrimary, scanLoading && styles.actionDisabled]}
              disabled={scanLoading}
              onPress={() => {
                void generateReport(skillInput);
              }}
            >
              {scanLoading ? (
                <ActivityIndicator color={adaptiveColor('#DBEAFE')} />
              ) : (
                <Text style={styles.actionPrimaryText}>{t('agents_scan_button')}</Text>
              )}
            </Pressable>

            {!!scanProgress && (
              <View style={styles.scanProgressPanel}>
                <Text style={styles.scanProgressTitle}>{scanStageLabel(scanProgress.stage, t)}</Text>
                <Text style={styles.scanProgressText}>{scanProgress.message}</Text>
                <Text style={styles.scanProgressMeta}>
                  {t('agents_scan_progress_scanned_files')}: {scanProgress.scannedFileCount} | {t('agents_scan_progress_queue')}: {scanProgress.queuedCount}
                </Text>
                {!!scanProgress.currentFilePath && (
                  <Text style={styles.scanProgressMeta} numberOfLines={1}>
                    {t('agents_scan_progress_current')}: {scanProgress.currentFilePath}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.skillsListPanel}>
            <Text style={styles.logsTitle}>{t('agents_installed_skills_title')}</Text>
            {skillsLoading ? (
              <ActivityIndicator color={adaptiveColor('#38BDF8')} />
            ) : skills.length === 0 ? (
              <Text style={styles.logTextMuted}>{t('agents_installed_skills_empty')}</Text>
            ) : (
              skills.map((skill) => (
                <View key={`${skill.name}:${skill.version}`} style={styles.skillCard}>
                  <View style={styles.skillHeader}>
                    <View>
                      <Text style={styles.skillName}>{skill.name}</Text>
                      <Text style={styles.skillVersion}>{skill.version}</Text>
                    </View>
                    <Pressable
                      style={[
                        styles.skillDeleteButton,
                        uninstallingSkill === skill.name && styles.actionDisabled,
                      ]}
                      disabled={uninstallingSkill === skill.name}
                      onPress={() => {
                        Alert.alert(t('agents_uninstall_confirm_title'), `${t('agents_uninstall_confirm_body')} ${skill.name}?`, [
                          { text: t('agents_action_cancel'), style: 'cancel' },
                          {
                            text: t('agents_uninstall_action'),
                            style: 'destructive',
                            onPress: () => {
                              void uninstallOneSkill(skill.name);
                            },
                          },
                        ]);
                      }}
                    >
                      {uninstallingSkill === skill.name ? (
                        <ActivityIndicator color={adaptiveColor('#FCA5A5')} />
                      ) : (
                        <Text style={styles.skillDeleteText}>{t('agents_uninstall_action')}</Text>
                      )}
                    </Pressable>
                  </View>

                  {!!skill.description && <Text style={styles.meta}>{skill.description}</Text>}
                  <Text style={styles.meta}>
                    {t('agents_installed_at')}: {skill.installedAt ? new Date(skill.installedAt).toLocaleString() : t('agents_skill_unknown_time')}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <CreateAgentModal
        visible={createModalVisible}
        creating={creatingAgent}
        name={createName}
        model={createModel}
        systemPrompt={createPrompt}
        onChangeName={setCreateName}
        onChangeModel={setCreateModel}
        onChangeSystemPrompt={setCreatePrompt}
        onClose={() => {
          if (!creatingAgent) {
            setCreateModalVisible(false);
          }
        }}
        onSubmit={() => {
          void handleSubmitCreateAgent();
        }}
      />

      <Modal
        visible={logsModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setLogsModalVisible(false);
        }}
      >
        <View style={styles.logsModalScreen}>
          <View style={styles.logsModalHeader}>
            <Text style={styles.logsModalTitle}>
              {t('agents_logs_title_prefix')}: {selectedAgentName}
            </Text>
            <Pressable
              style={styles.logsModalCloseButton}
              onPress={() => {
                setLogsModalVisible(false);
              }}
            >
              <Text style={styles.logsModalCloseText}>{t('common_close')}</Text>
            </Pressable>
          </View>

          {logsLoading ? (
            <View style={styles.logsModalLoading}>
              <ActivityIndicator color={adaptiveColor('#38BDF8')} />
            </View>
          ) : (
            <ScrollView style={styles.logsModalScroll} contentContainerStyle={styles.logsModalContent}>
              {selectedAgentLogs.length === 0 ? (
                <Text style={styles.logTextMuted}>{t('agents_logs_hint')}</Text>
              ) : (
                <>
                  {selectedAgentLogs.map((line, index) => (
                    <Text key={`${index}:${line}`} style={styles.logText}>
                      {line}
                    </Text>
                  ))}
                  {agentLogPaginationEnabled && logsHasMore && (
                    <Pressable
                      style={styles.logsLoadMoreButton}
                      onPress={() => {
                        void loadMoreAgentLogs();
                      }}
                    >
                      <Text style={styles.logsLoadMoreText}>
                        {language === 'zh' ? '再加载 100 条更早日志' : 'Load 100 older logs'}
                      </Text>
                    </Pressable>
                  )}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      <SecurityReportModal
        visible={!!report}
        report={report}
        approved={reportApproved}
        installing={installing}
        onClose={closeReport}
        onApprove={approveReport}
        onInstall={() => {
          void installApprovedSkill();
        }}
      />
    </View>
  );
}

const styles = createAdaptiveStyles({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  contentMaxWidth: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  topHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 6,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
  },
  createAgentButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#264653',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#264653',
  },
  createAgentButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  paneRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  paneChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0F172A',
  },
  paneChipActive: {
    borderColor: '#264653',
    backgroundColor: '#264653',
  },
  paneChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  paneChipTextActive: {
    color: '#FFFFFF',
  },
  error: {
    color: '#FCA5A5',
    fontSize: 12,
  },
  list: {
    padding: 16,
    gap: 12,
    paddingBottom: 30,
  },
  card: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0F172A',
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
  },
  model: {
    color: '#93C5FD',
    fontSize: 12,
  },
  name: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  meta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  action: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    paddingHorizontal: 12,
  },
  actionPrimary: {
    backgroundColor: '#264653',
  },
  actionPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  actionSecondary: {
    backgroundColor: '#5E7582',
  },
  actionSecondaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  actionDanger: {
    backgroundColor: '#B23A48',
  },
  actionDangerText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.55,
  },
  createOverlay: {
    flex: 1,
    backgroundColor: '#020617CC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  createSheet: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0B1220',
    padding: 14,
    gap: 8,
  },
  createTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  createSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
  },
  createLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  createInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    color: '#E2E8F0',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    minHeight: 42,
    fontSize: 13,
  },
  createPromptInput: {
    minHeight: 110,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  createActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  createAction: {
    flex: 1,
    borderRadius: 10,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCancel: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
  },
  createCancelText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
  },
  createConfirm: {
    backgroundColor: '#264653',
  },
  createConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  logsButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logsButtonText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 12,
  },
  logsPanel: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
    padding: 10,
    gap: 8,
    minHeight: 190,
  },
  logsTitle: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 13,
  },
  logsScroll: {
    maxHeight: 180,
  },
  logsContent: {
    gap: 4,
    paddingBottom: 8,
  },
  logsLoadMoreButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1D4ED8',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logsLoadMoreText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  logsModalScreen: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 52,
  },
  logsModalHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  logsModalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  logsModalCloseButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  logsModalCloseText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  logsModalLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logsModalScroll: {
    flex: 1,
    marginHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
  },
  logsModalContent: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 24,
  },
  logText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 14,
  },
  logTextMuted: {
    color: '#64748B',
    fontSize: 11,
  },
  emptyWrap: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0F172A',
    padding: 14,
    gap: 6,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  skillsScroll: {
    flex: 1,
  },
  skillsContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  flowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  flowChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0B1220',
  },
  flowChipActive: {
    borderColor: '#264653',
    backgroundColor: '#264653',
  },
  flowChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  flowChipTextActive: {
    color: '#FFFFFF',
  },
  skillInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    height: 42,
    color: '#E2E8F0',
    backgroundColor: '#0B1220',
    paddingHorizontal: 10,
  },
  scanProgressPanel: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: '#0B1220',
  },
  scanProgressTitle: {
    color: '#BFDBFE',
    fontSize: 12,
    fontWeight: '700',
  },
  scanProgressText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  scanProgressMeta: {
    color: '#64748B',
    fontSize: 11,
  },
  skillsListPanel: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
    padding: 10,
    gap: 10,
  },
  skillCard: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 6,
  },
  skillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skillName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  skillVersion: {
    color: '#93C5FD',
    fontSize: 12,
  },
  skillDeleteButton: {
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillDeleteText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
  reportScreen: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 56,
  },
  reportHeader: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  reportCloseButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reportCloseButtonText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  reportEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportEmptyText: {
    color: '#94A3B8',
  },
  reportSummary: {
    marginTop: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    gap: 4,
    backgroundColor: '#0B1220',
  },
  reportSummaryTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  riskBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#0F172A',
  },
  riskBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reportSummaryText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  permissionSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  permissionChip: {
    borderWidth: 1,
    borderColor: '#264653',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#16313A',
  },
  permissionChipText: {
    color: '#CAFFF5',
    fontSize: 11,
    fontWeight: '700',
  },
  reportTargetsPanel: {
    marginTop: 10,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    padding: 10,
    gap: 4,
    backgroundColor: '#0B1220',
  },
  reportTargetsTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  reportTargetItem: {
    color: '#94A3B8',
    fontSize: 11,
  },
  reportFindingsList: {
    padding: 16,
    gap: 8,
    paddingBottom: 110,
  },
  findingCard: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0B1220',
    padding: 10,
    gap: 4,
  },
  findingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  findingSeverity: {
    fontSize: 12,
    fontWeight: '700',
  },
  findingType: {
    color: '#CBD5E1',
    fontSize: 11,
  },
  findingPath: {
    color: '#93C5FD',
    fontSize: 11,
  },
  findingMatch: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  contextBox: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#020617',
    gap: 2,
  },
  contextLine: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 12,
  },
  reportActions: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
  },
  reportAction: {
    borderRadius: 10,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportActionApprove: {
    backgroundColor: '#1D4ED8',
  },
  reportActionInstall: {
    backgroundColor: '#0F766E',
  },
  reportActionDisabled: {
    opacity: 0.5,
  },
  reportActionText: {
    color: '#DBEAFE',
    fontSize: 13,
    fontWeight: '700',
  },
});
