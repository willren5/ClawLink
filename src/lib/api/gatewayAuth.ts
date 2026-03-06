import { getGatewayToken, saveGatewayToken } from '../secure/tokenVault';
import { buildGatewayBaseUrl } from '../utils/network';
import type { GatewayProfile } from '../../features/connection/types';

export const TOKEN_EXPIRY_WARNING_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_TRIGGER_MS = 5 * 60 * 1000;

interface RefreshGatewayTokenResult {
  token: string | null;
  refreshAvailable: boolean | null;
}

interface ResolveGatewayProfileAuthInput {
  profile: Pick<GatewayProfile, 'id' | 'host' | 'port' | 'tls' | 'tokenRef'>;
  previousRefreshAvailable?: boolean | null;
  skipTokenRefresh?: boolean;
}

export interface GatewayProfileAuthContext {
  baseUrl: string;
  token: string;
  expiresAt: number | null;
  refreshAvailable: boolean | null;
}

const tokenRefreshByProfile = new Map<string, Promise<RefreshGatewayTokenResult>>();

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    if (typeof atob === 'function') {
      return atob(padded);
    }
    const maybeBuffer = (
      globalThis as {
        Buffer?: {
          from: (input: string, encoding: string) => { toString: (encoding: string) => string };
        };
      }
    ).Buffer;
    if (maybeBuffer) {
      return maybeBuffer.from(padded, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

export function parseJwtExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  const payloadRaw = decodeBase64Url(parts[1]);
  if (!payloadRaw) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadRaw) as { exp?: unknown };
    const expSeconds =
      typeof payload.exp === 'number'
        ? payload.exp
        : typeof payload.exp === 'string'
          ? Number(payload.exp)
          : Number.NaN;
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
      return null;
    }
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

function extractRefreshedToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const node = payload as Record<string, unknown>;
  const direct =
    (typeof node.token === 'string' && node.token) ||
    (typeof node.accessToken === 'string' && node.accessToken) ||
    (typeof node.access_token === 'string' && node.access_token) ||
    '';
  if (direct.trim()) {
    return direct.trim();
  }

  if (node.data && typeof node.data === 'object') {
    return extractRefreshedToken(node.data);
  }

  return null;
}

async function tryRefreshGatewayToken(args: {
  baseUrl: string;
  currentToken: string;
  tokenRef: string;
  profileId: string;
  previousRefreshAvailable: boolean | null;
}): Promise<RefreshGatewayTokenResult> {
  const existing = tokenRefreshByProfile.get(args.profileId);
  if (existing) {
    return existing;
  }

  const refreshPromise = (async (): Promise<RefreshGatewayTokenResult> => {
    try {
      const response = await fetch(`${args.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.currentToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          return { token: null, refreshAvailable: false };
        }
        return {
          token: null,
          refreshAvailable: args.previousRefreshAvailable,
        };
      }

      const payload = (await response.json()) as unknown;
      const refreshedToken = extractRefreshedToken(payload);
      if (!refreshedToken) {
        return { token: null, refreshAvailable: true };
      }

      await saveGatewayToken(args.tokenRef, refreshedToken);
      return { token: refreshedToken, refreshAvailable: true };
    } catch {
      return {
        token: null,
        refreshAvailable: args.previousRefreshAvailable,
      };
    }
  })();

  tokenRefreshByProfile.set(args.profileId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    tokenRefreshByProfile.delete(args.profileId);
  }
}

export function toGatewayTokenState(
  expiresAt: number | null,
  refreshAvailable: boolean | null,
  previousRefreshAvailable: boolean | null,
): {
  tokenExpiresAt: number | null;
  tokenExpiringSoon: boolean;
  tokenRefreshAvailable: boolean | null;
} {
  const now = Date.now();
  return {
    tokenExpiresAt: expiresAt,
    tokenExpiringSoon: typeof expiresAt === 'number' ? expiresAt - now <= TOKEN_EXPIRY_WARNING_MS : false,
    tokenRefreshAvailable:
      typeof refreshAvailable === 'boolean' ? refreshAvailable : previousRefreshAvailable,
  };
}

export async function resolveGatewayProfileAuth(
  args: ResolveGatewayProfileAuthInput,
): Promise<GatewayProfileAuthContext> {
  const baseUrl = buildGatewayBaseUrl(args.profile.host, args.profile.port, args.profile.tls);
  const storedToken = await getGatewayToken(args.profile.tokenRef);
  if (!storedToken) {
    throw new Error('Gateway token not found in secure storage.');
  }

  let token = storedToken;
  let refreshAvailable = args.previousRefreshAvailable ?? null;
  const expiresAt = parseJwtExpiryMs(token);

  if (
    !args.skipTokenRefresh &&
    typeof expiresAt === 'number' &&
    expiresAt - Date.now() <= TOKEN_REFRESH_TRIGGER_MS
  ) {
    const refreshed = await tryRefreshGatewayToken({
      baseUrl,
      currentToken: token,
      tokenRef: args.profile.tokenRef,
      profileId: args.profile.id,
      previousRefreshAvailable: refreshAvailable,
    });
    if (refreshed.token) {
      token = refreshed.token;
    }
    refreshAvailable = refreshed.refreshAvailable;
  }

  return {
    baseUrl,
    token,
    expiresAt: parseJwtExpiryMs(token),
    refreshAvailable,
  };
}
