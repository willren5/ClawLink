export type SurfaceConnectionState = 'online' | 'offline' | 'degraded';
export const SYSTEM_SURFACE_SCHEMA_VERSION = 1;

export interface AgentActivitySummary {
  agentId: string;
  agentName: string;
  currentTask: string;
  model?: string;
  isStreaming: boolean;
}

export interface SystemSurfaceSnapshot {
  schemaVersion: number;
  title: string;
  subtitle: string;
  icon: string;
  connection: SurfaceConnectionState;
  activeSessions: number;
  activeChannels: number;
  pendingQueue: number;
  pendingMessages: number;
  timestamp: number;
  disconnectedSince: number | null;
  activeAgent: AgentActivitySummary | null;
  costToday: number | null;
  costYesterday: number | null;
  requestsToday: number | null;
  tokenUsageToday: number | null;
  errorCount: number;
}

export interface SystemSurfaceFullPayload {
  kind: 'full';
  schemaVersion: number;
  timestamp: number;
  snapshot: SystemSurfaceSnapshot;
}

export interface SystemSurfacePatchPayload {
  kind: 'patch';
  schemaVersion: number;
  timestamp: number;
  changedKeys: Array<keyof SystemSurfaceSnapshot>;
  snapshot: Partial<SystemSurfaceSnapshot>;
}

export type SystemSurfacePayload = SystemSurfaceFullPayload | SystemSurfacePatchPayload;

export interface MultiGatewaySurfaceItem {
  gatewayId: string;
  name: string;
  status: SurfaceConnectionState;
  lastCheck: number;
  isActive: boolean;
}

export interface MultiGatewaySurfaceState {
  schemaVersion: number;
  updatedAt: number;
  gateways: MultiGatewaySurfaceItem[];
}
