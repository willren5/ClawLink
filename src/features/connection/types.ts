import type { DevicesResponse, HealthResponse } from '../../lib/schemas';
import type { AppErrorCode } from '../../lib/errors/appError';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GatewayProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  tokenRef: string;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt?: number;
  hidden?: boolean;
}

export interface BackgroundGatewayHealth {
  profileId: string;
  profileName: string;
  status: ConnectionStatus;
  lastCheck: number;
  lastError: string | null;
}

export interface ConnectGatewayInput {
  name?: string;
  host: string;
  port: number;
  tls: boolean;
  token: string;
}

export interface ConnectionCheckResult {
  health: HealthResponse;
  devices: DevicesResponse;
  resolvedTls?: boolean;
}

export interface ConnectionErrorPayload {
  status?: number;
  code?: string;
  appCode?: AppErrorCode;
  message: string;
}

export interface BackgroundGatewayHealth {
  profileId: string;
  profileName: string;
  status: ConnectionStatus;
  lastCheck: number;
  lastError: string | null;
}
