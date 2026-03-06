import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { getNumber, setNumber } from '../../../lib/mmkv/storage';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { ensureNotificationPermission } from '../../notifications/services/pushRegistration';
import { resolveFocusFilterPolicy } from './focusFilter';
import { aggregateSystemSnapshot } from './snapshotAggregator';
import { publishSystemSurfaces } from './surfaceBridge';

const BACKGROUND_REFRESH_TASK = 'clawlink-background-refresh';
const BACKGROUND_MIN_INTERVAL_SECONDS = 15 * 60;
const OFFLINE_ALERT_DEDUPE_MS = 30 * 60 * 1000;
const ERROR_ALERT_DEDUPE_MS = 20 * 60 * 1000;
const STORAGE_KEY_OFFLINE_ALERT_AT = 'background:offline-alert-at';
const STORAGE_KEY_ERROR_ALERT_AT = 'background:error-alert-at';

async function notifyBackgroundAlert(title: string, body: string): Promise<void> {
  const focusPolicy = await resolveFocusFilterPolicy();
  if (!focusPolicy.allowNotifications) {
    return;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
    },
    trigger: null,
  });
}

async function evaluateBackgroundAlerts(): Promise<void> {
  const snapshot = aggregateSystemSnapshot();
  const now = Date.now();

  if (snapshot.connection !== 'online') {
    const lastOfflineAlertAt = getNumber(STORAGE_KEY_OFFLINE_ALERT_AT) ?? 0;
    if (now - lastOfflineAlertAt >= OFFLINE_ALERT_DEDUPE_MS) {
      setNumber(STORAGE_KEY_OFFLINE_ALERT_AT, now);
      await notifyBackgroundAlert('ClawLink Gateway offline', snapshot.subtitle || 'Check gateway connectivity.');
    }
  }

  if (snapshot.errorCount > 0) {
    const lastErrorAlertAt = getNumber(STORAGE_KEY_ERROR_ALERT_AT) ?? 0;
    if (now - lastErrorAlertAt >= ERROR_ALERT_DEDUPE_MS) {
      setNumber(STORAGE_KEY_ERROR_ALERT_AT, now);
      await notifyBackgroundAlert(
        'ClawLink detected agent errors',
        `${snapshot.errorCount} agent(s) reported error state.`,
      );
    }
  }
}

if (!TaskManager.isTaskDefined(BACKGROUND_REFRESH_TASK)) {
  TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
    try {
      const connection = useConnectionStore.getState();
      if (connection.activeProfileId) {
        await connection.pingActiveGateway();
      }

      const snapshot = aggregateSystemSnapshot();
      await publishSystemSurfaces(snapshot);
      await evaluateBackgroundAlerts();
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registerBackgroundRefreshTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) {
    return;
  }

  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
  if (registered) {
    return;
  }

  await BackgroundFetch.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
    minimumInterval: BACKGROUND_MIN_INTERVAL_SECONDS,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBackgroundRefreshTask(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
  if (!registered) {
    return;
  }
  await BackgroundFetch.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
}
