import type { AxiosError, AxiosRequestConfig, AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';

import { type ApiErrorResponse } from '../schemas';
import {
  APP_ERROR_CODES,
  ClawLinkError,
  inferAppErrorCode,
} from '../errors/appError';

export interface RequestMetaConfig {
  retryCount?: number;
  skipAuth?: boolean;
  skipRetry?: boolean;
  skipTokenRefresh?: boolean;
  retryOnRateLimit?: boolean;
}

export class ApiClientError extends ClawLinkError {
  constructor(input: ConstructorParameters<typeof ClawLinkError>[0]) {
    super(input);
    this.name = 'ApiClientError';
  }
}

function readHeaderValue(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  key: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();
  for (const [entryKey, value] of Object.entries(headers)) {
    if (entryKey.toLowerCase() !== normalizedKey) {
      continue;
    }

    if (Array.isArray(value)) {
      return value[0];
    }

    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

export function parseRetryAfterMs(value: string | undefined, now = Date.now()): number | null {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim();
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const parsedDate = Date.parse(normalized);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - now);
  }

  return null;
}

function isAxiosErrorWithBody(error: object): error is AxiosError<ApiErrorResponse> {
  return 'isAxiosError' in error;
}

function isRetryableMethod(method: string | undefined): boolean {
  const normalized = method?.trim().toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

export function resolveRetryDelayMs(error: AxiosError, retryCount: number, baseDelayMs: number): number {
  const retryAfterHeader = readHeaderValue(error.response?.headers, 'retry-after');
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs !== null) {
    return Math.max(baseDelayMs, retryAfterMs);
  }

  return baseDelayMs * 2 ** Math.max(0, retryCount - 1);
}

export function toApiClientError(error: unknown): ApiClientError {
  const fallbackMessage = error instanceof Error ? error.message : 'Unknown API error';

  if (!error || typeof error !== 'object') {
    return new ApiClientError({
      code: APP_ERROR_CODES.UNKNOWN,
      message: fallbackMessage,
    });
  }

  if (isAxiosErrorWithBody(error)) {
    const status = error.response?.status;
    const details = error.response?.data?.error;
    const message = error.response?.data?.message ?? error.message;
    const sourceCode = typeof details === 'string' && details.trim() ? details : error.code;
    return new ApiClientError({
      code: inferAppErrorCode({
        message,
        status,
        sourceCode,
        details,
      }),
      message,
      status,
      details,
      sourceCode,
      retryAfterMs: parseRetryAfterMs(readHeaderValue(error.response?.headers, 'retry-after')) ?? undefined,
      cause: error,
    });
  }

  if (error instanceof ClawLinkError) {
    return new ApiClientError({
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
      sourceCode: error.sourceCode,
      retryAfterMs: error.retryAfterMs,
      cause: error,
    });
  }

  return new ApiClientError({
    code: inferAppErrorCode({ message: fallbackMessage }),
    message: fallbackMessage,
    cause: error,
  });
}

export function shouldRetryRequest(error: AxiosError, maxRetryCount: number): boolean {
  const config = error.config as (AxiosRequestConfig & RequestMetaConfig) | undefined;
  const retryCount = config?.retryCount ?? 0;

  if (!config || config.skipRetry) {
    return false;
  }

  if (retryCount >= maxRetryCount) {
    return false;
  }

  const isRetryableRequest = isRetryableMethod(config.method);
  const status = error.response?.status;

  if (!error.response) {
    return isRetryableRequest;
  }

  if (status === 429) {
    return isRetryableRequest || config.retryOnRateLimit === true;
  }

  if (!isRetryableRequest) {
    return false;
  }

  return typeof status === 'number' && status >= 500;
}
