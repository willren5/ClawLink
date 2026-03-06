import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { registerPushToken } from '../../../lib/api';

export type PushDeliveryMode = 'remote' | 'local';

export interface PushRegistrationResult {
  mode: PushDeliveryMode;
  token?: string;
  reason?: string;
}

let setupDone = false;
let registrationPromise: Promise<PushRegistrationResult> | null = null;

function ensureNotificationHandler(): void {
  if (setupDone) {
    return;
  }
  setupDone = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

function isGatewayPushUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('404') ||
    message.includes('405') ||
    message.includes('not found') ||
    message.includes('unsupported')
  );
}

export async function ensureNotificationPermission(): Promise<boolean> {
  ensureNotificationHandler();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function registerPushTokenInternal(): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'ios') {
    return { mode: 'local', reason: 'non-ios-platform' };
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return { mode: 'local', reason: 'permission-denied' };
  }

  try {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    const token = typeof deviceToken.data === 'string' ? deviceToken.data.trim() : '';
    if (!token) {
      return { mode: 'local', reason: 'empty-device-token' };
    }

    try {
      await registerPushToken({
        token,
        platform: 'ios',
      });
      return { mode: 'remote', token };
    } catch (error: unknown) {
      if (isGatewayPushUnsupported(error)) {
        return { mode: 'local', token, reason: 'gateway-push-unsupported' };
      }
      return { mode: 'local', token, reason: error instanceof Error ? error.message : 'push-registration-failed' };
    }
  } catch (error: unknown) {
    return { mode: 'local', reason: error instanceof Error ? error.message : 'token-request-failed' };
  }
}

export async function registerForPushAlerts(): Promise<PushRegistrationResult> {
  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = registerPushTokenInternal().finally(() => {
    registrationPromise = null;
  });

  return registrationPromise;
}
