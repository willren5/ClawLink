import { useConnectionStore } from '../../features/connection/store/connectionStore';
import { resolveGatewayProfileAuth, toGatewayTokenState } from './gatewayAuth';

export const WS_PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT_MS = 12000;
const WS_OPERATOR_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing'];
const WS_CLIENT_ID = 'openclaw-ios';
const WS_CLIENT_VERSION = '1.0.0';
const WS_CLIENT_MODE = 'ui';
const WS_USER_AGENT = 'claw-link';
const WS_DEFAULT_LOCALE = 'zh-CN';
const WS_CONNECT_FALLBACK_PROFILES: Array<{
  role?: string;
  scopes?: string[];
  mode?: string;
}> = [
  { role: 'operator', scopes: WS_OPERATOR_SCOPES, mode: WS_CLIENT_MODE },
  { role: 'operator', scopes: [], mode: WS_CLIENT_MODE },
  { role: 'client', scopes: [], mode: 'mobile' },
  { role: 'user', scopes: [] },
  {},
];

interface GatewayWsFrame {
  type?: string;
  id?: string;
  ok?: boolean;
  event?: string;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

interface GatewayWsRequestOptions {
  timeoutMs?: number;
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function toHttpOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function createGatewaySocket(baseUrl: string): WebSocket {
  const wsUrl = toWebSocketUrl(baseUrl);
  const origin = toHttpOrigin(baseUrl);

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
}

function buildConnectPayload(
  token: string,
  profile: { role?: string; scopes?: string[]; mode?: string },
): Record<string, unknown> {
  return {
    minProtocol: WS_PROTOCOL_VERSION,
    maxProtocol: WS_PROTOCOL_VERSION,
    client: {
      id: WS_CLIENT_ID,
      version: WS_CLIENT_VERSION,
      platform: 'ios',
      mode: profile.mode ?? WS_CLIENT_MODE,
      instanceId: `claw-link-${Date.now()}`,
    },
    ...(profile.role ? { role: profile.role } : {}),
    ...(profile.scopes ? { scopes: profile.scopes } : {}),
    caps: [],
    auth: { token },
    userAgent: WS_USER_AGENT,
    locale: WS_DEFAULT_LOCALE,
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

function toErrorMessage(method: string, frame: GatewayWsFrame): string {
  const code = frame.error?.code ? `${frame.error.code}: ` : '';
  const message = frame.error?.message ?? 'gateway request failed';
  return `${method} -> ${code}${message}`;
}

export async function requestGatewayWs(
  method: string,
  params: Record<string, unknown> = {},
  options: GatewayWsRequestOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const state = useConnectionStore.getState();
  const activeProfile = state.activeProfileId
    ? state.profiles.find((profile) => profile.id === state.activeProfileId)
    : null;

  if (!activeProfile) {
    throw new Error('No active gateway profile. Please connect first.');
  }

  const auth = await resolveGatewayProfileAuth({
    profile: activeProfile,
    previousRefreshAvailable: state.tokenRefreshAvailable,
  });
  useConnectionStore.setState((current) => ({
    ...toGatewayTokenState(auth.expiresAt, auth.refreshAvailable, current.tokenRefreshAvailable),
  }));
  const { baseUrl, token } = auth;
  return new Promise<unknown>((resolve, reject) => {
    const ws = createGatewaySocket(baseUrl);
    const pending = new Map<
      string,
      {
        methodName: string;
        resolvePending: (payload: unknown) => void;
        rejectPending: (error: Error) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    >();

    let reqCounter = 0;
    let settled = false;
    let challengeReceived = false;

    const settle = (next: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(handshakeTimer);
      for (const [, entry] of pending) {
        clearTimeout(entry.timeoutId);
        entry.rejectPending(new Error('gateway websocket request interrupted'));
      }
      pending.clear();

      try {
        ws.close();
      } catch {
        // no-op
      }

      next();
    };

    const fail = (error: unknown): void => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      settle(() => {
        reject(normalized);
      });
    };

    const sendRequest = (methodName: string, payloadParams: Record<string, unknown>): Promise<unknown> => {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('gateway websocket is not connected'));
      }

      reqCounter += 1;
      const id = `req_${reqCounter}`;

      return new Promise<unknown>((resolvePending, rejectPending) => {
        const timeoutId = setTimeout(() => {
          pending.delete(id);
          rejectPending(new Error(`${methodName} timeout (${timeoutMs}ms)`));
        }, timeoutMs);

        pending.set(id, {
          methodName,
          resolvePending,
          rejectPending,
          timeoutId,
        });

        ws.send(
          JSON.stringify({
            type: 'req',
            id,
            method: methodName,
            params: payloadParams,
          }),
        );
      });
    };

    const handshakeTimer = setTimeout(() => {
      fail(new Error(`gateway websocket handshake timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }

      let frame: GatewayWsFrame;
      try {
        frame = JSON.parse(event.data) as GatewayWsFrame;
      } catch {
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge' && !challengeReceived) {
        challengeReceived = true;
        clearTimeout(handshakeTimer);
        const connectThenRequest = async (): Promise<unknown> => {
          let lastError: unknown = new Error('Gateway connect handshake failed.');

          for (const profile of WS_CONNECT_FALLBACK_PROFILES) {
            try {
              await sendRequest('connect', buildConnectPayload(token, profile));
              return sendRequest(method, params);
            } catch (error: unknown) {
              lastError = error;
              if (!shouldRetryConnectProfile(error)) {
                throw error;
              }
            }
          }

          throw lastError;
        };

        void connectThenRequest()
          .then((payload) => {
            settle(() => {
              resolve(payload);
            });
          })
          .catch((error: unknown) => {
            fail(error);
          });
        return;
      }

      if (frame.type !== 'res' || typeof frame.id !== 'string') {
        return;
      }

      const pendingEntry = pending.get(frame.id);
      if (!pendingEntry) {
        return;
      }

      clearTimeout(pendingEntry.timeoutId);
      pending.delete(frame.id);

      if (frame.ok) {
        pendingEntry.resolvePending(frame.payload);
      } else {
        pendingEntry.rejectPending(new Error(toErrorMessage(pendingEntry.methodName, frame)));
      }
    };

    ws.onerror = () => {
      fail(new Error('gateway websocket connection failed'));
    };

    ws.onclose = (event: CloseEvent) => {
      if (settled) {
        return;
      }

      const reason = event.reason?.trim() || 'gateway websocket closed unexpectedly';
      fail(new Error(reason));
    };
  });
}
