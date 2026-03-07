import assert from 'node:assert/strict';
import test from 'node:test';

import type { AxiosError } from 'axios';

import { APP_ERROR_CODES } from '../errors/appError';
import { parseRetryAfterMs, shouldRetryRequest, toApiClientError } from './types';

test('parseRetryAfterMs supports delta seconds and absolute dates', () => {
  assert.equal(parseRetryAfterMs('3', 1000), 3000);
  assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1000), 4000);
  assert.equal(parseRetryAfterMs('invalid-value', 1000), null);
});

test('shouldRetryRequest retries 429 for idempotent requests only by default', () => {
  const getError = {
    config: { method: 'GET', retryCount: 0 },
    response: { status: 429, headers: { 'retry-after': '1' } },
  } as unknown as AxiosError;
  const postError = {
    config: { method: 'POST', retryCount: 0 },
    response: { status: 429, headers: { 'retry-after': '1' } },
  } as unknown as AxiosError;
  const forcedPostError = {
    config: { method: 'POST', retryCount: 0, retryOnRateLimit: true },
    response: { status: 429, headers: { 'retry-after': '1' } },
  } as unknown as AxiosError;

  assert.equal(shouldRetryRequest(getError, 2), true);
  assert.equal(shouldRetryRequest(postError, 2), false);
  assert.equal(shouldRetryRequest(forcedPostError, 2), true);
});

test('toApiClientError maps server codes and statuses into app error codes', () => {
  const error = {
    isAxiosError: true,
    message: 'Request failed with status code 403',
    code: 'ERR_BAD_REQUEST',
    response: {
      status: 403,
      data: {
        message: 'Device must be approved first.',
        error: 'PAIRING_REQUIRED',
      },
      headers: {},
    },
  } as unknown as AxiosError<{ message?: string; error?: string }>;

  const apiError = toApiClientError(error);

  assert.equal(apiError.code, APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED);
  assert.equal(apiError.status, 403);
  assert.equal(apiError.sourceCode, 'PAIRING_REQUIRED');
});
