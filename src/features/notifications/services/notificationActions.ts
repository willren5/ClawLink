import * as Notifications from 'expo-notifications';

import { translate } from '../../../lib/i18n';
import { useAppPreferencesStore, type AppLanguage } from '../../settings/store/preferencesStore';
import type { SystemSurfaceSnapshot } from '../../system-surfaces/types';
import {
  defaultDeepLinkForAlert,
  describeAlertQuickAction,
  describeAlertQuickActions,
} from '../incidentDefinitions';
import { executeAlertQuickAction } from './incidentActions';
import { useAlertStore } from '../store/alertStore';
import type { AlertQuickActionId, AlertType } from '../types';

export const ALERT_NOTIFICATION_CATEGORIES = {
  disconnect: 'clawlink_disconnect',
  queue: 'clawlink_queue',
  agent: 'clawlink_agent',
  budget: 'clawlink_budget',
} as const;

export const ALERT_NOTIFICATION_ACTIONS = {
  reconnect: 'reconnect_gateway',
  openMonitor: 'open_monitor',
  flushQueue: 'flush_queue',
  openChat: 'open_chat',
  refreshAgents: 'refresh_agents',
  openAgents: 'open_agents',
  openDashboard: 'open_dashboard',
} as const;

function formatRelativeDuration(ms: number, language: AppLanguage): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return language === 'zh' ? `${totalSeconds} 秒` : `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return language === 'zh' ? `${totalMinutes} 分钟` : `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return language === 'zh' ? `${totalHours} 小时` : `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return language === 'zh' ? `${totalDays} 天` : `${totalDays}d`;
}

export function buildAlertDetail(type: AlertType, snapshot: SystemSurfaceSnapshot, language: AppLanguage): string {
  switch (type) {
    case 'disconnect_timeout':
      if (typeof snapshot.disconnectedSince === 'number') {
        const duration = formatRelativeDuration(Date.now() - snapshot.disconnectedSince, language);
        return language === 'zh' ? `已断连 ${duration}` : `Offline for ${duration}`;
      }
      return '';
    case 'queue_backlog':
      return language === 'zh'
        ? `待发送 ${snapshot.pendingQueue} 条，待同步 ${snapshot.pendingMessages} 条`
        : `${snapshot.pendingQueue} queued, ${snapshot.pendingMessages} pending sync`;
    case 'agent_error':
    case 'error_count_transition':
      return language === 'zh'
        ? `异常 Agent ${snapshot.errorCount} 个`
        : `${snapshot.errorCount} agents reporting errors`;
    case 'budget_near_limit':
    case 'budget_exceeded':
      return '';
    default:
      return '';
  }
}

function categoryForAlertType(type: AlertType): string {
  if (type === 'disconnect_timeout') {
    return ALERT_NOTIFICATION_CATEGORIES.disconnect;
  }

  if (type === 'queue_backlog') {
    return ALERT_NOTIFICATION_CATEGORIES.queue;
  }

  if (type === 'budget_near_limit' || type === 'budget_exceeded') {
    return ALERT_NOTIFICATION_CATEGORIES.budget;
  }

  return ALERT_NOTIFICATION_CATEGORIES.agent;
}

function categoryActions(language: AppLanguage): Record<string, Notifications.NotificationAction[]> {
  return {
    [ALERT_NOTIFICATION_CATEGORIES.disconnect]: describeAlertQuickActions('disconnect_timeout', language).map((item) => ({
      identifier: item.id,
      buttonTitle: item.label,
    })),
    [ALERT_NOTIFICATION_CATEGORIES.queue]: describeAlertQuickActions('queue_backlog', language).map((item) => ({
      identifier: item.id,
      buttonTitle: item.label,
    })),
    [ALERT_NOTIFICATION_CATEGORIES.agent]: describeAlertQuickActions('agent_error', language).map((item) => ({
      identifier: item.id,
      buttonTitle: item.label,
    })),
    [ALERT_NOTIFICATION_CATEGORIES.budget]: describeAlertQuickActions('budget_exceeded', language).map((item) => ({
      identifier: item.id,
      buttonTitle: item.label,
    })),
  };
}

export async function registerAlertNotificationCategories(language: AppLanguage): Promise<void> {
  const actionsByCategory = categoryActions(language);

  await Promise.all(
    Object.entries(actionsByCategory).map(([identifier, actions]) =>
      Notifications.setNotificationCategoryAsync(identifier, actions, {
        previewPlaceholder: 'ClawLink',
        showTitle: true,
        showSubtitle: true,
      }),
    ),
  );
}

export function buildAlertNotificationContent(args: {
  alertId: string;
  type: AlertType;
  title: string;
  body: string;
  snapshot: SystemSurfaceSnapshot;
  language: AppLanguage;
}): {
  title: string;
  body: string;
  categoryIdentifier: string;
  data: Record<string, unknown>;
} {
  const detail = buildAlertDetail(args.type, args.snapshot, args.language);

  return {
    title: args.title,
    body: detail ? `${args.body} · ${detail}` : args.body,
    categoryIdentifier: categoryForAlertType(args.type),
    data: {
      alertId: args.alertId,
      type: args.type,
      deepLink: defaultDeepLinkForAlert(args.type),
    },
  };
}

export function getAlertQuickActions(
  type: AlertType,
  language: AppLanguage,
): Array<{ id: AlertQuickActionId; label: string; deepLink?: string }> {
  return describeAlertQuickActions(type, language).map((item) => ({
    id: item.id,
    label: item.label,
    deepLink: item.deepLink,
  }));
}

export function getAlertQuickAction(
  actionId: AlertQuickActionId,
  language: AppLanguage,
): { id: AlertQuickActionId; label: string; deepLink?: string } {
  const descriptor = describeAlertQuickAction(actionId, language);
  return {
    id: descriptor.id,
    label: descriptor.label,
    deepLink: descriptor.deepLink,
  };
}

export async function handleAlertNotificationResponse(
  response: Notifications.NotificationResponse | null,
  handleUrl: (url: string) => void,
): Promise<void> {
  if (!response) {
    return;
  }

  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  const deepLink = typeof data?.deepLink === 'string' ? data.deepLink : null;
  const alertId = typeof data?.alertId === 'string' ? data.alertId : null;

  if (alertId) {
    useAlertStore.getState().markRead(alertId);
  }

  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    if (deepLink) {
      handleUrl(deepLink);
    }
    return;
  }

  const supportedActionIds = new Set<AlertQuickActionId>([
    ALERT_NOTIFICATION_ACTIONS.reconnect,
    ALERT_NOTIFICATION_ACTIONS.openMonitor,
    ALERT_NOTIFICATION_ACTIONS.flushQueue,
    ALERT_NOTIFICATION_ACTIONS.openChat,
    ALERT_NOTIFICATION_ACTIONS.refreshAgents,
    ALERT_NOTIFICATION_ACTIONS.openAgents,
    ALERT_NOTIFICATION_ACTIONS.openDashboard,
  ]);
  const actionId = response.actionIdentifier as AlertQuickActionId;

  if (supportedActionIds.has(actionId)) {
    await executeAlertQuickAction(actionId).catch(() => undefined);
    const action = describeAlertQuickAction(actionId, getCurrentNotificationLanguage());
    if (action.deepLink) {
      handleUrl(action.deepLink);
      return;
    }
  }

  if (deepLink) {
    handleUrl(deepLink);
  }
}

export function getCurrentNotificationLanguage(): AppLanguage {
  return useAppPreferencesStore.getState().language;
}

export function buildAlertStrings(
  language: AppLanguage,
  payload: {
    titleKey:
      | 'notifications_alert_agent_error_title'
      | 'notifications_alert_disconnect_title'
      | 'notifications_alert_queue_title'
      | 'notifications_alert_error_transition_title';
    bodyKey:
      | 'notifications_alert_agent_error_body'
      | 'notifications_alert_disconnect_body'
      | 'notifications_alert_queue_body'
      | 'notifications_alert_error_transition_body';
  },
): { title: string; body: string } {
  return {
    title: translate(language, payload.titleKey),
    body: translate(language, payload.bodyKey),
  };
}
