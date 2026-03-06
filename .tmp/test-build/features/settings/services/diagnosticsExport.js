"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSensitiveText = redactSensitiveText;
exports.buildDiagnosticsPayload = buildDiagnosticsPayload;
exports.maskIdentifier = maskIdentifier;
const debugProfile_1 = require("../../connection/debugProfile");
function maskIdentifier(value) {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }
    if (normalized === debugProfile_1.HIDDEN_DEBUG_PROFILE_ID) {
        return '[hidden-debug-profile]';
    }
    if (normalized.length <= 8) {
        return `${normalized.slice(0, 2)}***${normalized.slice(-1)}`;
    }
    return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}
function redactTokenLikeText(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]')
        .replace(/\b(token|api[_ -]?token)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
        .replace(new RegExp(debugProfile_1.HIDDEN_DEBUG_PROFILE_ID, 'g'), '[hidden-debug-profile]')
        .replace(/ocg_debug_token__[A-Za-z0-9_]+/gi, '[redacted-debug-token]');
}
function redactSensitiveText(value) {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }
    return redactTokenLikeText(normalized);
}
function sanitizeAuditEntry(entry) {
    return {
        ...entry,
        target: redactSensitiveText(entry.target) ?? '[redacted]',
        detail: redactSensitiveText(entry.detail) ?? undefined,
    };
}
function buildDiagnosticsPayload(input) {
    return {
        generatedAt: input.generatedAt,
        app: input.app,
        preferences: input.preferences,
        connection: {
            status: input.connection.status,
            activeProfileId: maskIdentifier(input.connection.activeProfileId),
            profileCount: input.connection.profileCount,
            hiddenDebugProfilePresent: input.connection.hiddenDebugProfilePresent,
            lastHealthCheckAt: input.connection.lastHealthCheckAt,
            lastError: redactSensitiveText(input.connection.lastError),
            tokenExpiresAt: input.connection.tokenExpiresAt,
            tokenExpiringSoon: input.connection.tokenExpiringSoon,
            tokenRefreshAvailable: input.connection.tokenRefreshAvailable,
        },
        dashboard: {
            ...input.dashboard,
            lastError: redactSensitiveText(input.dashboard.lastError),
        },
        chat: {
            ...input.chat,
            activeAgentId: maskIdentifier(input.chat.activeAgentId),
            activeSessionId: maskIdentifier(input.chat.activeSessionId),
            lastError: redactSensitiveText(input.chat.lastError),
        },
        auditLogs: {
            count: input.auditEntries.length,
            entries: input.auditEntries.slice(-200).map(sanitizeAuditEntry),
        },
    };
}
