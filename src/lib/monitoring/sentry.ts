import * as Sentry from '@sentry/react-native';

let initialized = false;

function readSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

export function initSentry(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    enabled: true,
    debug: process.env.EXPO_PUBLIC_SENTRY_DEBUG === '1',
    tracesSampleRate: readSampleRate(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.2),
    sendDefaultPii: false,
  });
}

export { Sentry };
