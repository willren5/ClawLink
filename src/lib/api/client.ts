import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { z, ZodError, type ZodSchema } from 'zod';

import { useConnectionStore } from '../../features/connection/store/connectionStore';
import { buildGatewayBaseUrl } from '../utils/network';
import { resolveGatewayProfileAuth, toGatewayTokenState } from './gatewayAuth';
import { shouldRetryRequest, toApiClientError, type RequestMetaConfig } from './types';

const MAX_RETRY_COUNT = 2;
const RETRY_BASE_DELAY_MS = 350;
const DEFAULT_TIMEOUT_MS = 15000;

export const apiClient: AxiosInstance = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
});

function isHtmlPayload(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

function parseApiPayload<TSchema extends ZodSchema>(
  path: string,
  schema: TSchema,
  payload: unknown,
): z.infer<TSchema> {
  if (isHtmlPayload(payload)) {
    throw new Error(
      `Gateway returned HTML for ${path}. 请确认 Host/Port 指向 API 网关（OpenClaw 默认端口通常是 18789）。`,
    );
  }

  try {
    return schema.parse(payload);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const pathLabel = issue?.path?.length ? issue.path.join('.') : path;
      throw new Error(`Unexpected API response for ${pathLabel}: ${issue?.message ?? 'schema validation failed'}`);
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function updateTokenStatus(expiresAt: number | null, refreshAvailable: boolean | null): void {
  useConnectionStore.setState((state) => ({
    ...toGatewayTokenState(expiresAt, refreshAvailable, state.tokenRefreshAvailable),
  }));
}

async function resolveAuthHeader(
  config: InternalAxiosRequestConfig & RequestMetaConfig,
): Promise<InternalAxiosRequestConfig & RequestMetaConfig> {
  const state = useConnectionStore.getState();
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);

  if (activeProfile && !config.baseURL) {
    config.baseURL = buildGatewayBaseUrl(activeProfile.host, activeProfile.port, activeProfile.tls);
  }

  if (config.skipAuth) {
    return config;
  }

  if (!activeProfile) {
    throw new Error('No active gateway profile. Please connect first.');
  }

  const auth = await resolveGatewayProfileAuth({
    profile: activeProfile,
    previousRefreshAvailable: state.tokenRefreshAvailable,
    skipTokenRefresh: config.skipTokenRefresh,
  });
  updateTokenStatus(auth.expiresAt, auth.refreshAvailable);

  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }

  if (!config.baseURL) {
    config.baseURL = auth.baseUrl;
  }

  config.headers.Authorization = `Bearer ${auth.token}`;
  config.headers['Content-Type'] = 'application/json';

  return config;
}

apiClient.interceptors.request.use(async (config) => {
  const mutableConfig = config as InternalAxiosRequestConfig & RequestMetaConfig;
  return resolveAuthHeader(mutableConfig);
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!shouldRetryRequest(error, MAX_RETRY_COUNT)) {
      return Promise.reject(toApiClientError(error));
    }

    const config = error.config as (AxiosRequestConfig & RequestMetaConfig) | undefined;
    if (!config) {
      return Promise.reject(toApiClientError(error));
    }

    config.retryCount = (config.retryCount ?? 0) + 1;
    const delayMs = RETRY_BASE_DELAY_MS * 2 ** (config.retryCount - 1);
    await sleep(delayMs);
    return apiClient(config);
  },
);

export async function apiGet<TSchema extends ZodSchema>(
  path: string,
  schema: TSchema,
  config?: AxiosRequestConfig & RequestMetaConfig,
): Promise<z.infer<TSchema>> {
  const response = await apiClient.get<unknown, AxiosResponse<unknown>>(path, config);
  return parseApiPayload(path, schema, response.data);
}

export async function apiPost<TSchema extends ZodSchema, TBody extends Record<string, unknown> | undefined = undefined>(
  path: string,
  body: TBody,
  schema: TSchema,
  config?: AxiosRequestConfig & RequestMetaConfig,
): Promise<z.infer<TSchema>> {
  const response = await apiClient.post<unknown, AxiosResponse<unknown>>(path, body, config);
  return parseApiPayload(path, schema, response.data);
}

export async function apiPatch<TSchema extends ZodSchema, TBody extends Record<string, unknown> | undefined = undefined>(
  path: string,
  body: TBody,
  schema: TSchema,
  config?: AxiosRequestConfig & RequestMetaConfig,
): Promise<z.infer<TSchema>> {
  const response = await apiClient.patch<unknown, AxiosResponse<unknown>>(path, body, config);
  return parseApiPayload(path, schema, response.data);
}

export async function apiDelete<TSchema extends ZodSchema>(
  path: string,
  schema: TSchema,
  config?: AxiosRequestConfig & RequestMetaConfig,
): Promise<z.infer<TSchema>> {
  const response = await apiClient.delete<unknown, AxiosResponse<unknown>>(path, config);
  return parseApiPayload(path, schema, response.data);
}
