import * as Notifications from 'expo-notifications';

import { resolveFocusFilterPolicy } from '../../system-surfaces/services/focusFilter';
import { subscribeSnapshotChanges } from '../../system-surfaces/services/snapshotAggregator';
import type { SystemSurfaceSnapshot } from '../../system-surfaces/types';
import { defaultDeepLinkForAlert } from '../incidentDefinitions';
import { useAlertStore } from '../store/alertStore';
import type { AlertSeverity, AlertType } from '../types';
import { buildDailyBudgetAlert, hasPublishedDailyBudgetAlert, markDailyBudgetAlertPublished } from './budgetAlerts';
import {
  buildAlertNotificationContent,
  buildAlertStrings,
  getCurrentNotificationLanguage,
} from './notificationActions';
import { ensureNotificationPermission } from './pushRegistration';

const ALERT_DEDUPE_MS = 5 * 60 * 1000;
const DISCONNECT_ALERT_AFTER_MS = 60 * 1000;
const QUEUE_THRESHOLD = 10;
const QUEUE_THRESHOLD_DURATION_MS = 30 * 1000;
const WATCHDOG_INTERVAL_MS = 3000;

let stopMonitor: (() => void) | null = null;

interface AlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  titleKey?:
    | 'notifications_alert_agent_error_title'
    | 'notifications_alert_disconnect_title'
    | 'notifications_alert_queue_title'
    | 'notifications_alert_error_transition_title';
  bodyKey?:
    | 'notifications_alert_agent_error_body'
    | 'notifications_alert_disconnect_body'
    | 'notifications_alert_queue_body'
    | 'notifications_alert_error_transition_body';
  title?: string;
  body?: string;
  dedupeKey: string;
  dedupeMs?: number;
}

interface AlertEvaluatorState {
  latestSnapshot: SystemSurfaceSnapshot | null;
  previousErrorCount: number;
  queueBacklogSince: number | null;
  dedupeByCondition: Map<string, number>;
}

async function shouldPublishInFocusMode(): Promise<boolean> {
  try {
    const policy = await resolveFocusFilterPolicy();
    return policy.allowNotifications;
  } catch {
    return true;
  }
}

function shouldEmit(state: AlertEvaluatorState, dedupeKey: string, now: number, dedupeMs = ALERT_DEDUPE_MS): boolean {
  const last = state.dedupeByCondition.get(dedupeKey);
  if (typeof last === 'number' && now - last < dedupeMs) {
    return false;
  }
  state.dedupeByCondition.set(dedupeKey, now);
  return true;
}

async function publishAlert(state: AlertEvaluatorState, payload: AlertPayload): Promise<boolean> {
  if (!(await shouldPublishInFocusMode())) {
    return false;
  }

  const now = Date.now();
  if (useAlertStore.getState().isAlertSnoozed(payload.type, payload.dedupeKey, now)) {
    return false;
  }
  if (!shouldEmit(state, payload.dedupeKey, now, payload.dedupeMs)) {
    return false;
  }

  const language = getCurrentNotificationLanguage();
  const { title, body } =
    typeof payload.title === 'string' && typeof payload.body === 'string'
      ? { title: payload.title, body: payload.body }
      : buildAlertStrings(language, {
          titleKey: payload.titleKey ?? 'notifications_alert_agent_error_title',
          bodyKey: payload.bodyKey ?? 'notifications_alert_agent_error_body',
        });
  const entry = useAlertStore.getState().addAlert({
    type: payload.type,
    severity: payload.severity,
    title,
    body,
    dedupeKey: payload.dedupeKey,
    deepLink: defaultDeepLinkForAlert(payload.type),
  });
  if (!entry) {
    return false;
  }
  const content = buildAlertNotificationContent({
    alertId: entry.id,
    type: payload.type,
    title,
    body,
    snapshot: state.latestSnapshot ?? {
      schemaVersion: 1,
      title: 'ClawLink',
      subtitle: '',
      icon: 'bolt.fill',
      connection: 'offline',
      activeSessions: 0,
      activeChannels: 0,
      pendingQueue: 0,
      pendingMessages: 0,
      timestamp: now,
      disconnectedSince: null,
      activeAgent: null,
      costToday: null,
      costYesterday: null,
      requestsToday: null,
      tokenUsageToday: null,
      errorCount: 0,
    },
    language,
  });

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return false;
  }

  await Notifications.scheduleNotificationAsync({
    content,
    trigger: null,
  });
  return true;
}

async function evaluateSnapshot(state: AlertEvaluatorState): Promise<void> {
  const snapshot = state.latestSnapshot;
  if (!snapshot) {
    return;
  }

  const now = Date.now();

  if (snapshot.errorCount > state.previousErrorCount) {
    await publishAlert(state, {
      type: 'agent_error',
      severity: 'critical',
      titleKey: 'notifications_alert_agent_error_title',
      bodyKey: 'notifications_alert_agent_error_body',
      dedupeKey: 'agent_error_increase',
    });
  }

  if (state.previousErrorCount === 0 && snapshot.errorCount > 0) {
    await publishAlert(state, {
      type: 'error_count_transition',
      severity: 'warning',
      titleKey: 'notifications_alert_error_transition_title',
      bodyKey: 'notifications_alert_error_transition_body',
      dedupeKey: 'error_count_transition',
    });
  }

  if (
    snapshot.disconnectedSince &&
    Number.isFinite(snapshot.disconnectedSince) &&
    now - snapshot.disconnectedSince >= DISCONNECT_ALERT_AFTER_MS
  ) {
    await publishAlert(state, {
      type: 'disconnect_timeout',
      severity: 'critical',
      titleKey: 'notifications_alert_disconnect_title',
      bodyKey: 'notifications_alert_disconnect_body',
      dedupeKey: 'disconnect_timeout',
    });
  }

  if (snapshot.pendingQueue > QUEUE_THRESHOLD) {
    if (state.queueBacklogSince === null) {
      state.queueBacklogSince = now;
    }
    if (now - state.queueBacklogSince >= QUEUE_THRESHOLD_DURATION_MS) {
      await publishAlert(state, {
        type: 'queue_backlog',
        severity: 'warning',
        titleKey: 'notifications_alert_queue_title',
        bodyKey: 'notifications_alert_queue_body',
        dedupeKey: 'queue_backlog',
      });
    }
  } else {
    state.queueBacklogSince = null;
  }

  const budgetAlert = buildDailyBudgetAlert(snapshot.costToday, now);
  if (budgetAlert && !hasPublishedDailyBudgetAlert(budgetAlert)) {
    const published = await publishAlert(state, {
      type: budgetAlert.type,
      severity: budgetAlert.severity,
      title: budgetAlert.title,
      body: budgetAlert.body,
      dedupeKey: `${budgetAlert.type}:${budgetAlert.dayKey}`,
      dedupeMs: budgetAlert.dedupeMs,
    });
    if (published) {
      markDailyBudgetAlertPublished(budgetAlert);
    }
  }

  state.previousErrorCount = snapshot.errorCount;
}

export function startLocalAlertsMonitor(): () => void {
  if (stopMonitor) {
    return stopMonitor;
  }

  const state: AlertEvaluatorState = {
    latestSnapshot: null,
    previousErrorCount: 0,
    queueBacklogSince: null,
    dedupeByCondition: new Map<string, number>(),
  };

  const unsubscribe = subscribeSnapshotChanges((snapshot) => {
    state.latestSnapshot = snapshot;
    void evaluateSnapshot(state);
  });

  const timer = setInterval(() => {
    void evaluateSnapshot(state);
  }, WATCHDOG_INTERVAL_MS);

  stopMonitor = () => {
    clearInterval(timer);
    unsubscribe();
    stopMonitor = null;
  };

  return stopMonitor;
}
