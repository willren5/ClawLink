import * as Notifications from 'expo-notifications';

import { getAgents } from '../../../lib/api';
import { translate } from '../../../lib/i18n';
import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useDashboardStore } from '../../dashboard/store/dashboardStore';
import { useAppPreferencesStore, type AppLanguage } from '../../settings/store/preferencesStore';
import { aggregateSystemSnapshot } from '../../system-surfaces/services/snapshotAggregator';
import { publishSystemSurfaces } from '../../system-surfaces/services/surfaceBridge';
import type { SystemSurfaceSnapshot } from '../../system-surfaces/types';
import { useAlertStore, type AlertType } from '../store/alertStore';

export const ALERT_NOTIFICATION_CATEGORIES = {
  disconnect: 'clawlink_disconnect',
  queue: 'clawlink_queue',
  agent: 'clawlink_agent',
} as const;

export const ALERT_NOTIFICATION_ACTIONS = {
  reconnect: 'action_reconnect_gateway',
  openMonitor: 'action_open_monitor',
  flushQueue: 'action_flush_queue',
  openChat: 'action_open_chat',
  refreshAgents: 'action_refresh_agents',
  openAgents: 'action_open_agents',
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

  return ALERT_NOTIFICATION_CATEGORIES.agent;
}

function defaultDeepLinkForAlert(type: AlertType): string {
  if (type === 'queue_backlog') {
    return 'clawlink://chat';
  }

  if (type === 'disconnect_timeout') {
    return 'clawlink://monitor';
  }

  return 'clawlink://agents';
}

function categoryActions(language: AppLanguage): Record<string, Notifications.NotificationAction[]> {
  return {
    [ALERT_NOTIFICATION_CATEGORIES.disconnect]: [
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.reconnect,
        buttonTitle: language === 'zh' ? '立即重连' : 'Reconnect',
      },
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.openMonitor,
        buttonTitle: language === 'zh' ? '打开监控' : 'Open Monitor',
      },
    ],
    [ALERT_NOTIFICATION_CATEGORIES.queue]: [
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.flushQueue,
        buttonTitle: language === 'zh' ? '刷新队列' : 'Flush Queue',
      },
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.openChat,
        buttonTitle: language === 'zh' ? '打开聊天' : 'Open Chat',
      },
    ],
    [ALERT_NOTIFICATION_CATEGORIES.agent]: [
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.refreshAgents,
        buttonTitle: language === 'zh' ? '刷新状态' : 'Refresh',
      },
      {
        identifier: ALERT_NOTIFICATION_ACTIONS.openAgents,
        buttonTitle: language === 'zh' ? '打开 Agents' : 'Open Agents',
      },
    ],
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

async function refreshOperationalState(): Promise<void> {
  await Promise.allSettled([
    useConnectionStore.getState().pingActiveGateway(),
    useConnectionStore.getState().pollAllGateways(),
    useDashboardStore.getState().refresh(),
    getAgents().then((response) => {
      useAgentsRuntimeStore.getState().hydrateAgents(response.agents);
    }),
  ]);

  await publishSystemSurfaces(aggregateSystemSnapshot()).catch(() => undefined);
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

  switch (response.actionIdentifier) {
    case ALERT_NOTIFICATION_ACTIONS.reconnect:
      await refreshOperationalState();
      handleUrl('clawlink://dashboard');
      return;
    case ALERT_NOTIFICATION_ACTIONS.openMonitor:
      handleUrl('clawlink://monitor');
      return;
    case ALERT_NOTIFICATION_ACTIONS.flushQueue:
      await useChatStore.getState().flushPendingQueue().catch(() => undefined);
      handleUrl('clawlink://chat');
      return;
    case ALERT_NOTIFICATION_ACTIONS.openChat:
      handleUrl('clawlink://chat');
      return;
    case ALERT_NOTIFICATION_ACTIONS.refreshAgents:
      await refreshOperationalState();
      handleUrl('clawlink://agents');
      return;
    case ALERT_NOTIFICATION_ACTIONS.openAgents:
      handleUrl('clawlink://agents');
      return;
    default:
      if (deepLink) {
        handleUrl(deepLink);
      }
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
