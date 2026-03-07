"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const diagnosticsExport_1 = require("./diagnosticsExport");
(0, node_test_1.default)('redacts token-shaped strings in freeform diagnostics text', () => {
    const result = (0, diagnosticsExport_1.redactSensitiveText)('Bearer abc.def.ghi token=super-secret-value');
    strict_1.default.equal(result, 'Bearer [REDACTED] token=[REDACTED]');
});
(0, node_test_1.default)('masks identifiers and strips hidden debug token details from diagnostics payload', () => {
    const payload = (0, diagnosticsExport_1.buildDiagnosticsPayload)({
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
            pricingCurrency: 'USD',
            dailyBudget: 20,
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
    const typedPayload = payload;
    strict_1.default.equal(typedPayload.connection.activeProfileId, '[hidden-debug-profile]');
    strict_1.default.equal(typedPayload.connection.lastError, 'token=[REDACTED]');
    strict_1.default.equal(typedPayload.chat.activeAgentId, 'agen...1234');
    strict_1.default.equal(typedPayload.chat.lastError, 'Bearer [REDACTED]');
    strict_1.default.equal(typedPayload.auditLogs.entries[0].target, 'token=[REDACTED]');
    strict_1.default.equal(typedPayload.auditLogs.entries[0].detail, 'Bearer [REDACTED]');
});
