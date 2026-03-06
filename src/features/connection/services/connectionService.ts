import axios, { AxiosError } from 'axios';
import { ZodError } from 'zod';

import {
  DevicesResponseSchema,
  HealthResponseSchema,
  type DevicesResponse,
  type HealthResponse,
} from '../../../lib/schemas';
import { buildGatewayBaseUrl, normalizeHost } from '../../../lib/utils/network';
import type { ConnectGatewayInput, ConnectionCheckResult, ConnectionErrorPayload, GatewayProfile } from '../types';

const REQUEST_TIMEOUT_MS = 10000;
const WS_FALLBACK_TIMEOUT_MS = 10000;
const WS_OPERATOR_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing'];
const WS_CLIENT_ID = 'openclaw-ios';
const WS_CLIENT_VERSION = '1.0.0';
const WS_CONNECT_FALLBACK_PROFILES: Array<{
  role?: string;
  scopes?: string[];
  mode?: string;
}> = [
  { role: 'operator', scopes: WS_OPERATOR_SCOPES, mode: 'ui' },
  { role: 'operator', scopes: [], mode: 'ui' },
  { role: 'client', scopes: [], mode: 'mobile' },
  { role: 'user', scopes: [] },
  {},
];

export class ConnectionError extends Error implements ConnectionErrorPayload {
  status?: number;
  code?: string;

  constructor(payload: ConnectionErrorPayload) {
    super(payload.message);
    this.name = 'ConnectionError';
    this.status = payload.status;
    this.code = payload.code;
  }
}

function shouldTryTlsFlip(error: unknown): boolean {
  const lowered = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (lowered.includes('http 401') || lowered.includes('http 403')) {
    return false;
  }

  return (
    lowered.includes('network') ||
    lowered.includes('timeout') ||
    lowered.includes('ssl') ||
    lowered.includes('tls') ||
    lowered.includes('wrong version number') ||
    lowered.includes('unexpected eof') ||
    lowered.includes('econnrefused') ||
    lowered.includes('connection refused') ||
    lowered.includes('could not connect') ||
    lowered.includes('socket hang up') ||
    lowered.includes('empty reply') ||
    lowered.includes('http 404')
  );
}

function toConnectionError(error: unknown): ConnectionError {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError<{ message?: string; error?: string }>;
    const status = axiosError.response?.status;
    const serverMessage = axiosError.response?.data?.message ?? axiosError.response?.data?.error;
    const message = serverMessage ?? axiosError.message;
    return new ConnectionError({
      status,
      code: axiosError.code,
      message: `HTTP ${status ?? 'NETWORK'}: ${message}`,
    });
  }

  if (error instanceof Error) {
    return new ConnectionError({ message: error.message });
  }

  return new ConnectionError({ message: 'Unknown connection error' });
}

function isHtmlPayload(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

function parseHealthPayload(value: unknown): HealthResponse {
  if (isHtmlPayload(value)) {
    throw new ConnectionError({
      message:
        'Gateway 返回了 HTML 页面而不是 API JSON。请确认 Host/Port 指向 API 网关（默认 18789）并且不是 Web 控制台静态站点。',
    });
  }

  try {
    return HealthResponseSchema.parse(value);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new ConnectionError({
        message: `健康检查响应格式不正确: ${error.issues[0]?.message ?? 'invalid response'}`,
      });
    }
    throw error;
  }
}

function parseDevicesPayload(value: unknown): DevicesResponse {
  if (isHtmlPayload(value)) {
    return { devices: [] };
  }

  try {
    return DevicesResponseSchema.parse(value);
  } catch {
    return { devices: [] };
  }
}

function buildWsGatewayUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function toHttpOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function shouldTryWsFallback(error: unknown): boolean {
  const normalizedFromMessage = (message: string): boolean => {
    const normalized = message.toLowerCase();

    if (normalized.includes('http 401') || normalized.includes('http 403')) {
      return false;
    }

    return (
      normalized.includes('http 404') ||
      normalized.includes('html') ||
      normalized.includes('invalid response') ||
      normalized.includes('response format') ||
      normalized.includes('expected object') ||
      normalized.includes('响应格式') ||
      normalized.includes('返回了 html') ||
      normalized.includes('network error') ||
      normalized.includes('empty reply') ||
      normalized.includes('socket hang up') ||
      normalized.includes('connection refused') ||
      normalized.includes('could not connect')
    );
  };

  if (error instanceof ConnectionError) {
    return normalizedFromMessage(error.message);
  }

  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
      return false;
    }

    if (axiosError.response?.status === 404) {
      return true;
    }

    if (!axiosError.response) {
      const code = (axiosError.code ?? '').toLowerCase();
      const message = (axiosError.message ?? '').toLowerCase();
      return (
        code === 'err_network' ||
        code === 'econnaborted' ||
        message.includes('network error') ||
        message.includes('socket hang up') ||
        message.includes('empty reply') ||
        message.includes('connection refused') ||
        message.includes('could not connect')
      );
    }

    return false;
  }

  if (error instanceof Error) {
    return normalizedFromMessage(error.message);
  }

  return false;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof ConnectionError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeWsCloseReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    return 'gateway websocket closed unexpectedly';
  }
  return normalized;
}

function buildConnectPayload(
  token: string,
  profile: { role?: string; scopes?: string[]; mode?: string },
): Record<string, unknown> {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: WS_CLIENT_ID,
      version: WS_CLIENT_VERSION,
      platform: 'ios',
      mode: profile.mode ?? 'ui',
      instanceId: `claw-link-${Date.now()}`,
    },
    ...(profile.role ? { role: profile.role } : {}),
    ...(profile.scopes ? { scopes: profile.scopes } : {}),
    caps: [],
    auth: { token },
    userAgent: 'claw-link',
    locale: 'zh-CN',
  };
}

function shouldRetryConnectProfile(error: unknown): boolean {
  const lowered = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    lowered.includes('scope') ||
    lowered.includes('role') ||
    lowered.includes('permission') ||
    lowered.includes('forbidden') ||
    lowered.includes('unauthorized') ||
    lowered.includes('denied') ||
    lowered.includes('invalid') ||
    lowered.includes('schema') ||
    lowered.includes('connect')
  );
}

async function probeGatewayViaWebSocket(baseUrl: string, token: string): Promise<HealthResponse> {
  return new Promise<HealthResponse>((resolve, reject) => {
    const wsUrl = buildWsGatewayUrl(baseUrl);
    const origin = toHttpOrigin(baseUrl);
    const ws = (() => {
      try {
        const Ctor = WebSocket as unknown as {
          new (
            url: string,
            protocols?: string | string[],
            options?: {
              headers?: Record<string, string>;
            },
          ): WebSocket;
        };

        return new Ctor(wsUrl, undefined, {
          headers: {
            Origin: origin,
          },
        });
      } catch {
        return new WebSocket(wsUrl);
      }
    })();
    const pending = new Map<string, { resolve: (payload: unknown) => void; reject: (error: Error) => void }>();
    let requestId = 0;
    let settled = false;
    let connectStarted = false;
    let helloVersion: string | undefined;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // no-op
        }
        reject(new ConnectionError({ message: 'WebSocket gateway handshake timed out.' }));
      }
    }, WS_FALLBACK_TIMEOUT_MS);

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      for (const [, entry] of pending) {
        entry.reject(new ConnectionError({ message: 'WebSocket gateway handshake interrupted.' }));
      }
      pending.clear();
      try {
        ws.close();
      } catch {
        // no-op
      }
      fn();
    };

    const sendRequest = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new ConnectionError({ message: 'WebSocket gateway is not connected.' }));
      }

      requestId += 1;
      const id = `req_${requestId}`;

      return new Promise<unknown>((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        ws.send(
          JSON.stringify({
            type: 'req',
            id,
            method,
            params: params ?? {},
          }),
        );
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      if (!payload) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const frame = parsed as {
        type?: string;
        event?: string;
        payload?: unknown;
        id?: string;
        ok?: boolean;
        error?: { code?: string; message?: string };
      };

      if (frame.type === 'event' && frame.event === 'connect.challenge' && !connectStarted) {
        connectStarted = true;
        const connectAndProbe = async (): Promise<void> => {
          let lastError: unknown = new ConnectionError({ message: 'WebSocket gateway connect failed.' });

          for (const profile of WS_CONNECT_FALLBACK_PROFILES) {
            try {
              const hello = await sendRequest('connect', buildConnectPayload(token, profile));
              if (hello && typeof hello === 'object') {
                const maybeServer = (hello as { server?: { version?: unknown } }).server;
                if (maybeServer && typeof maybeServer.version === 'string') {
                  helloVersion = maybeServer.version;
                }
              }
              const healthPayload = await sendRequest('health', {});
              const status = Boolean((healthPayload as { ok?: unknown })?.ok) ? 'ok' : 'degraded';
              settle(() => {
                resolve({
                  status,
                  uptimeSeconds: 0,
                  version: helloVersion,
                  timestamp: new Date().toISOString(),
                });
              });
              return;
            } catch (error: unknown) {
              lastError = error;
              if (!shouldRetryConnectProfile(error)) {
                throw error;
              }
            }
          }

          throw lastError;
        };

        void connectAndProbe()
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : 'WebSocket gateway connect failed during handshake.';
            settle(() => {
              reject(new ConnectionError({ message }));
            });
          });
        return;
      }

      if (frame.type === 'res' && typeof frame.id === 'string') {
        const pendingEntry = pending.get(frame.id);
        if (!pendingEntry) {
          return;
        }

        pending.delete(frame.id);
        if (frame.ok) {
          pendingEntry.resolve(frame.payload);
        } else {
          pendingEntry.reject(
            new ConnectionError({
              code: frame.error?.code,
              message: frame.error?.message ?? 'WebSocket gateway request failed.',
            }),
          );
        }
      }
    };

    ws.onerror = () => {
      settle(() => {
        reject(new ConnectionError({ message: 'WebSocket gateway connection failed.' }));
      });
    };

    ws.onclose = (event: CloseEvent) => {
      if (settled) {
        return;
      }

      settle(() => {
        reject(
          new ConnectionError({
            code: `${event.code}`,
            message: normalizeWsCloseReason(event.reason),
          }),
        );
      });
    };
  });
}

export function createGatewayProfile(input: ConnectGatewayInput): GatewayProfile {
  const normalizedHost = normalizeHost(input.host);
  const now = Date.now();
  const profileId = `gw_${now}_${Math.floor(Math.random() * 1_000_000)}`;

  return {
    id: profileId,
    name: input.name?.trim() || `${normalizedHost}:${input.port}`,
    host: normalizedHost,
    port: input.port,
    tls: input.tls,
    tokenRef: profileId,
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: now,
  };
}

export async function checkGatewayHealth(
  baseUrl: string,
  token: string,
): Promise<{ health: HealthResponse; devices: DevicesResponse }> {
  const client = axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  try {
    const healthResponse = await client.get<unknown>('/api/health');

    let devicesPayload: unknown = { devices: [] };
    try {
      const devicesResponse = await client.get<unknown>('/api/devices');
      devicesPayload = devicesResponse.data;
    } catch {
      devicesPayload = { devices: [] };
    }

    return {
      health: parseHealthPayload(healthResponse.data),
      devices: parseDevicesPayload(devicesPayload),
    };
  } catch (error: unknown) {
    if (shouldTryWsFallback(error)) {
      try {
        const wsHealth = await probeGatewayViaWebSocket(baseUrl, token);
        return {
          health: wsHealth,
          devices: { devices: [] },
        };
      } catch (wsError: unknown) {
        const primaryMessage = extractErrorMessage(error);
        const wsMessage = extractErrorMessage(wsError);
        throw new ConnectionError({
          message: `${primaryMessage} (WebSocket fallback failed: ${wsMessage})`,
        });
      }
    }
    throw error;
  }
}

export async function pingGatewayHealth(baseUrl: string, token: string): Promise<HealthResponse> {
  const client = axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  try {
    const response = await client.get<unknown>('/api/health');
    return parseHealthPayload(response.data);
  } catch (error: unknown) {
    if (shouldTryWsFallback(error)) {
      try {
        return await probeGatewayViaWebSocket(baseUrl, token);
      } catch (wsError: unknown) {
        const primaryMessage = extractErrorMessage(error);
        const wsMessage = extractErrorMessage(wsError);
        throw new ConnectionError({
          message: `${primaryMessage} (WebSocket fallback failed: ${wsMessage})`,
        });
      }
    }
    throw error;
  }
}

export async function connectToGateway(input: ConnectGatewayInput): Promise<ConnectionCheckResult> {
  const normalizedHost = normalizeHost(input.host);
  const primaryBaseUrl = buildGatewayBaseUrl(normalizedHost, input.port, input.tls);

  try {
    const primary = await checkGatewayHealth(primaryBaseUrl, input.token);
    return {
      ...primary,
      resolvedTls: input.tls,
    };
  } catch (primaryError: unknown) {
    if (shouldTryTlsFlip(primaryError)) {
      const fallbackTls = !input.tls;
      const fallbackBaseUrl = buildGatewayBaseUrl(normalizedHost, input.port, fallbackTls);

      try {
        const fallback = await checkGatewayHealth(fallbackBaseUrl, input.token);
        return {
          ...fallback,
          resolvedTls: fallbackTls,
        };
      } catch {
        // Keep original error context.
      }
    }

    throw toConnectionError(primaryError);
  }
}
