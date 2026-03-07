export const APP_ERROR_CODES = {
  AUTH_EXPIRED: 'E_AUTH_EXPIRED',
  AUTH_FORBIDDEN: 'E_AUTH_FORBIDDEN',
  AUTH_REFRESH_FAILED: 'E_AUTH_REFRESH_FAILED',
  GATEWAY_UNREACHABLE: 'E_GATEWAY_UNREACHABLE',
  GATEWAY_ENDPOINT_NOT_FOUND: 'E_GATEWAY_ENDPOINT_NOT_FOUND',
  GATEWAY_ORIGIN_NOT_ALLOWED: 'E_GATEWAY_ORIGIN_NOT_ALLOWED',
  GATEWAY_PAIRING_REQUIRED: 'E_GATEWAY_PAIRING_REQUIRED',
  GATEWAY_DEVICE_IDENTITY_REQUIRED: 'E_GATEWAY_DEVICE_IDENTITY_REQUIRED',
  HTTP_RATE_LIMITED: 'E_HTTP_RATE_LIMITED',
  HTTP_SERVER_ERROR: 'E_HTTP_SERVER_ERROR',
  MODEL_UNSUPPORTED: 'E_MODEL_UNSUPPORTED',
  REQUEST_INVALID: 'E_REQUEST_INVALID',
  RESPONSE_SCHEMA_INVALID: 'E_RESPONSE_SCHEMA_INVALID',
  SESSION_NOT_FOUND: 'E_SESSION_NOT_FOUND',
  FEATURE_UNSUPPORTED: 'E_FEATURE_UNSUPPORTED',
  PUSH_UNSUPPORTED: 'E_PUSH_UNSUPPORTED',
  TIMEOUT: 'E_TIMEOUT',
  WS_CONNECT_FAILED: 'E_WS_CONNECT_FAILED',
  WS_FRAME_INVALID: 'E_WS_FRAME_INVALID',
  UNKNOWN: 'E_UNKNOWN',
} as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

export interface ClawLinkErrorOptions {
  code: AppErrorCode;
  message: string;
  status?: number;
  details?: string;
  sourceCode?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

export class ClawLinkError extends Error {
  readonly code: AppErrorCode;
  readonly status?: number;
  readonly details?: string;
  readonly sourceCode?: string;
  readonly retryAfterMs?: number;

  constructor(options: ClawLinkErrorOptions) {
    super(options.message);
    this.name = 'ClawLinkError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.sourceCode = options.sourceCode;
    this.retryAfterMs = options.retryAfterMs;
    if ('cause' in Error.prototype) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function normalizedValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function inferAppErrorCode(input: {
  message?: string | null;
  status?: number | null;
  sourceCode?: string | null;
  details?: string | null;
}): AppErrorCode {
  const message = normalizedValue(input.message);
  const sourceCode = normalizedValue(input.sourceCode);
  const details = normalizedValue(input.details);
  const combined = [sourceCode, details, message].filter(Boolean).join(' ');

  if (includesAny(combined, ['pairing_required'])) {
    return APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED;
  }

  if (includesAny(combined, ['device_identity_required'])) {
    return APP_ERROR_CODES.GATEWAY_DEVICE_IDENTITY_REQUIRED;
  }

  if (includesAny(combined, ['origin not allowed'])) {
    return APP_ERROR_CODES.GATEWAY_ORIGIN_NOT_ALLOWED;
  }

  if (
    includesAny(combined, ['too many requests', 'rate limit']) ||
    input.status === 429
  ) {
    return APP_ERROR_CODES.HTTP_RATE_LIMITED;
  }

  if (
    includesAny(combined, ['unsupported model', 'model was rejected']) ||
    (combined.includes('model') && includesAny(combined, ['invalid', 'not found', 'not available']))
  ) {
    return APP_ERROR_CODES.MODEL_UNSUPPORTED;
  }

  if (
    combined.includes('session') &&
    includesAny(combined, ['not found', 'unknown session'])
  ) {
    return APP_ERROR_CODES.SESSION_NOT_FOUND;
  }

  if (
    includesAny(combined, [
      'invalid_request',
      'unexpected property',
      'must have required property',
      'schema',
      'expected object',
      'invalid input',
    ])
  ) {
    return APP_ERROR_CODES.REQUEST_INVALID;
  }

  if (
    includesAny(combined, ['html page', 'returned html', 'unexpected api response']) ||
    combined.includes('schema validation failed')
  ) {
    return APP_ERROR_CODES.RESPONSE_SCHEMA_INVALID;
  }

  if (includesAny(combined, ['timeout'])) {
    return APP_ERROR_CODES.TIMEOUT;
  }

  if (
    includesAny(combined, [
      'network request failed',
      'load failed',
      'could not connect',
      'connection refused',
      'socket hang up',
      'empty reply',
      'econnrefused',
      'err_network',
      'nsurlerrordomain',
    ])
  ) {
    return APP_ERROR_CODES.GATEWAY_UNREACHABLE;
  }

  if (includesAny(combined, ['gateway websocket connection failed', 'gateway websocket closed unexpectedly'])) {
    return APP_ERROR_CODES.WS_CONNECT_FAILED;
  }

  if (includesAny(combined, ['invalid websocket frame', 'malformed websocket frame'])) {
    return APP_ERROR_CODES.WS_FRAME_INVALID;
  }

  if (includesAny(combined, ['unsupported', 'not implemented', 'not available', 'unavailable'])) {
    return APP_ERROR_CODES.FEATURE_UNSUPPORTED;
  }

  if (sourceCode === 'push_unsupported') {
    return APP_ERROR_CODES.PUSH_UNSUPPORTED;
  }

  if (input.status === 401 || includesAny(combined, ['http 401', 'unauthorized', 'token expired'])) {
    return APP_ERROR_CODES.AUTH_EXPIRED;
  }

  if (input.status === 403 || includesAny(combined, ['http 403', 'forbidden', 'insufficient_scope', 'permission'])) {
    return APP_ERROR_CODES.AUTH_FORBIDDEN;
  }

  if (input.status === 404 || includesAny(combined, ['http 404', 'not found'])) {
    return APP_ERROR_CODES.GATEWAY_ENDPOINT_NOT_FOUND;
  }

  if (typeof input.status === 'number' && input.status >= 500) {
    return APP_ERROR_CODES.HTTP_SERVER_ERROR;
  }

  return APP_ERROR_CODES.UNKNOWN;
}

export function toClawLinkError(
  error: unknown,
  fallback: Partial<Omit<ClawLinkErrorOptions, 'code' | 'message'>> & { message?: string } = {},
): ClawLinkError {
  if (error instanceof ClawLinkError) {
    return error;
  }

  if (error instanceof Error) {
    const appCode =
      typeof (error as { appCode?: unknown }).appCode === 'string'
        ? ((error as { appCode?: AppErrorCode }).appCode ?? undefined)
        : undefined;
    return new ClawLinkError({
      code:
        appCode ??
        inferAppErrorCode({
          message: error.message,
          ...(typeof (error as { status?: unknown }).status === 'number'
            ? { status: (error as { status?: number }).status }
            : {}),
          ...(typeof (error as { code?: unknown }).code === 'string'
            ? { sourceCode: (error as { code?: string }).code }
            : {}),
        }),
      message: error.message,
      ...fallback,
      cause: error,
    });
  }

  const message = typeof error === 'string' ? error : fallback.message ?? 'Unknown error';
  return new ClawLinkError({
    code: inferAppErrorCode({ message }),
    message,
    ...fallback,
    cause: error,
  });
}

export function getAppErrorCode(error: unknown): AppErrorCode {
  return toClawLinkError(error).code;
}

export function hasAppErrorCode(error: unknown, ...codes: AppErrorCode[]): boolean {
  return codes.includes(getAppErrorCode(error));
}
