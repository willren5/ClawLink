"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClientError = void 0;
exports.parseRetryAfterMs = parseRetryAfterMs;
exports.resolveRetryDelayMs = resolveRetryDelayMs;
exports.toApiClientError = toApiClientError;
exports.shouldRetryRequest = shouldRetryRequest;
const appError_1 = require("../errors/appError");
class ApiClientError extends appError_1.ClawLinkError {
    constructor(input) {
        super(input);
        this.name = 'ApiClientError';
    }
}
exports.ApiClientError = ApiClientError;
function readHeaderValue(headers, key) {
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
function parseRetryAfterMs(value, now = Date.now()) {
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
function isAxiosErrorWithBody(error) {
    return 'isAxiosError' in error;
}
function isRetryableMethod(method) {
    const normalized = method?.trim().toUpperCase();
    return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}
function resolveRetryDelayMs(error, retryCount, baseDelayMs) {
    const retryAfterHeader = readHeaderValue(error.response?.headers, 'retry-after');
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) {
        return Math.max(baseDelayMs, retryAfterMs);
    }
    return baseDelayMs * 2 ** Math.max(0, retryCount - 1);
}
function toApiClientError(error) {
    const fallbackMessage = error instanceof Error ? error.message : 'Unknown API error';
    if (!error || typeof error !== 'object') {
        return new ApiClientError({
            code: appError_1.APP_ERROR_CODES.UNKNOWN,
            message: fallbackMessage,
        });
    }
    if (isAxiosErrorWithBody(error)) {
        const status = error.response?.status;
        const details = error.response?.data?.error;
        const message = error.response?.data?.message ?? error.message;
        const sourceCode = typeof details === 'string' && details.trim() ? details : error.code;
        return new ApiClientError({
            code: (0, appError_1.inferAppErrorCode)({
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
    if (error instanceof appError_1.ClawLinkError) {
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
        code: (0, appError_1.inferAppErrorCode)({ message: fallbackMessage }),
        message: fallbackMessage,
        cause: error,
    });
}
function shouldRetryRequest(error, maxRetryCount) {
    const config = error.config;
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
