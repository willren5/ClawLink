import { HIDDEN_DEBUG_PROFILE_ID } from '../../connection/debugProfile';
import type { AuditLogEntry } from '../../security/store/auditLogStore';

interface AppMetaInput {
  name: string;
  version: string;
  build: string;
  runtimeVersion: string;
  platform: string;
  debug: boolean;
}

interface PreferencesInput {
  language: 'zh' | 'en';
  themePreference: string;
  accentColor: string;
  liveActivityEnabled: boolean;
  dynamicIslandEnabled: boolean;
  widgetEnabled: boolean;
  dashboardSectionOrder: string[];
  pricingCurrency: string;
  dailyBudget: number | null;
}

interface ConnectionInput {
  status: string;
  activeProfileId: string | null;
  profileCount: number;
  hiddenDebugProfilePresent: boolean;
  lastHealthCheckAt: number | null;
  lastError: string | null;
  tokenExpiresAt: number | null;
  tokenExpiringSoon: boolean;
  tokenRefreshAvailable: boolean | null;
}

interface DashboardInput {
  lastFetchedAt: number;
  activeSessions: number;
  activeChannels: number;
  refreshIntervalSeconds: number;
  lastError: string | null;
}

interface ChatInput {
  activeAgentId: string | null;
  activeSessionId: string | null;
  sessionCount: number;
  loadedSessionCount: number;
  pendingQueueCount: number;
  failedOutboundCount: number;
  lastError: string | null;
  streaming: boolean;
  syncing: boolean;
}

export interface DiagnosticsPayloadInput {
  generatedAt: string;
  app: AppMetaInput;
  preferences: PreferencesInput;
  connection: ConnectionInput;
  dashboard: DashboardInput;
  chat: ChatInput;
  auditEntries: AuditLogEntry[];
}

function maskIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized === HIDDEN_DEBUG_PROFILE_ID) {
    return '[hidden-debug-profile]';
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-1)}`;
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function redactTokenLikeText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|api[_ -]?token)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(new RegExp(HIDDEN_DEBUG_PROFILE_ID, 'g'), '[hidden-debug-profile]')
    .replace(/ocg_debug_token__[A-Za-z0-9_]+/gi, '[redacted-debug-token]');
}

export function redactSensitiveText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return redactTokenLikeText(normalized);
}

function sanitizeAuditEntry(entry: AuditLogEntry): AuditLogEntry {
  return {
    ...entry,
    target: redactSensitiveText(entry.target) ?? '[redacted]',
    detail: redactSensitiveText(entry.detail) ?? undefined,
  };
}

export function buildDiagnosticsPayload(input: DiagnosticsPayloadInput): Record<string, unknown> {
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

export { maskIdentifier };
