import type { AxiosError, AxiosRequestConfig } from 'axios';

import type { ApiErrorResponse } from '../schemas';

export interface RequestMetaConfig {
  retryCount?: number;
  skipAuth?: boolean;
  skipRetry?: boolean;
  skipTokenRefresh?: boolean;
}

export interface ApiClientError {
  name: 'ApiClientError';
  message: string;
  status?: number;
  code?: string;
  details?: string;
}

export function toApiClientError(error: unknown): ApiClientError {
  const fallback: ApiClientError = {
    name: 'ApiClientError',
    message: 'Unknown API error',
  };

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  if (isAxiosErrorWithBody(error)) {
    return {
      name: 'ApiClientError',
      message: error.response?.data?.message ?? error.message,
      status: error.response?.status,
      code: error.code,
      details: error.response?.data?.error,
    };
  }

  if ('message' in error && typeof error.message === 'string') {
    return {
      ...fallback,
      message: error.message,
    };
  }

  return fallback;
}

function isAxiosErrorWithBody(error: object): error is AxiosError<ApiErrorResponse> {
  return 'isAxiosError' in error;
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

  if (!error.response) {
    return true;
  }

  return error.response.status >= 500;
}
