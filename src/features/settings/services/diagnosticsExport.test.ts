import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDiagnosticsPayload, redactSensitiveText } from './diagnosticsExport';

test('redacts token-shaped strings in freeform diagnostics text', () => {
  const result = redactSensitiveText('Bearer abc.def.ghi token=super-secret-value');

  assert.equal(result, 'Bearer [REDACTED] token=[REDACTED]');
});

test('masks identifiers and strips hidden debug token details from diagnostics payload', () => {
  const payload = buildDiagnosticsPayload({
    generatedAt: '2026-03-06T00:00:00.000Z',
    app: {
      name: 'ClawLink',
      version: '1.0.0',
      build: '1',
      runtimeVersion: '1',
      platform: 'ios',
      debug: false,
    },
    preferences: {
      language: 'zh',
      themePreference: 'system',
      accentColor: '#264653',
      liveActivityEnabled: true,
      dynamicIslandEnabled: true,
      widgetEnabled: true,
      dashboardSectionOrder: ['volume'],
    },
    connection: {
      status: 'connected',
      activeProfileId: 'gw_hidden_debug_user',
      profileCount: 2,
      hiddenDebugProfilePresent: true,
      lastHealthCheckAt: 123,
      lastError: 'token=secret-value',
      tokenExpiresAt: null,
      tokenExpiringSoon: false,
      tokenRefreshAvailable: null,
    },
    dashboard: {
      lastFetchedAt: 456,
      activeSessions: 1,
      activeChannels: 1,
      refreshIntervalSeconds: 30,
      lastError: null,
    },
    chat: {
      activeAgentId: 'agent-main-1234',
      activeSessionId: 'session-abcdef',
      sessionCount: 1,
      loadedSessionCount: 1,
      pendingQueueCount: 0,
      failedOutboundCount: 0,
      lastError: 'Bearer should-not-leak',
      streaming: false,
      syncing: false,
    },
    auditEntries: [
      {
        id: '1',
        timestamp: 789,
        action: 'restart_gateway',
        target: 'token=my-token',
        result: 'success',
        detail: 'Bearer hidden-value',
      },
    ],
  });
  const typedPayload = payload as {
    connection: { activeProfileId: string | null; lastError: string | null };
    chat: { activeAgentId: string | null; lastError: string | null };
    auditLogs: { entries: Array<{ target: string; detail?: string }> };
  };

  assert.equal(typedPayload.connection.activeProfileId, '[hidden-debug-profile]');
  assert.equal(typedPayload.connection.lastError, 'token=[REDACTED]');
  assert.equal(typedPayload.chat.activeAgentId, 'agen...1234');
  assert.equal(typedPayload.chat.lastError, 'Bearer [REDACTED]');
  assert.equal(typedPayload.auditLogs.entries[0].target, 'token=[REDACTED]');
  assert.equal(typedPayload.auditLogs.entries[0].detail, 'Bearer [REDACTED]');
});
