export const STORAGE_KEYS = {
  CONNECTION_STORE: 'connection-store',
  PERMISSION_STORE: 'permission-store',
  APP_PREFERENCES_STORE: 'app-preferences-store',
  PRICING_STORE: 'pricing-store',
  DASHBOARD_STORE: 'dashboard-store',
  CHAT_STORE: 'chat-store',
  AGENTS_RUNTIME_STORE: 'agents-runtime-store',
  AGENT_ACTIVITY_STORE: 'agent-activity-store',
  ALERT_STORE: 'alert-store',
  AUDIT_LOG_STORE: 'audit-log-store',
  HEALTH_BRIDGE_STORE: 'health-bridge-store',
  LAST_DASHBOARD_SNAPSHOT: 'dashboard:last-snapshot',
  SYSTEM_SURFACE_SNAPSHOT: 'system-surface:snapshot',
  MULTI_GATEWAY_SURFACE_STATE: 'multi-gateway:status',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
