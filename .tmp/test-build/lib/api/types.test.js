"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const appError_1 = require("../errors/appError");
const types_1 = require("./types");
(0, node_test_1.default)('parseRetryAfterMs supports delta seconds and absolute dates', () => {
    strict_1.default.equal((0, types_1.parseRetryAfterMs)('3', 1000), 3000);
    strict_1.default.equal((0, types_1.parseRetryAfterMs)('Thu, 01 Jan 1970 00:00:05 GMT', 1000), 4000);
    strict_1.default.equal((0, types_1.parseRetryAfterMs)('invalid-value', 1000), null);
});
(0, node_test_1.default)('shouldRetryRequest retries 429 for idempotent requests only by default', () => {
    const getError = {
        config: { method: 'GET', retryCount: 0 },
        response: { status: 429, headers: { 'retry-after': '1' } },
    };
    const postError = {
        config: { method: 'POST', retryCount: 0 },
        response: { status: 429, headers: { 'retry-after': '1' } },
    };
    const forcedPostError = {
        config: { method: 'POST', retryCount: 0, retryOnRateLimit: true },
        response: { status: 429, headers: { 'retry-after': '1' } },
    };
    strict_1.default.equal((0, types_1.shouldRetryRequest)(getError, 2), true);
    strict_1.default.equal((0, types_1.shouldRetryRequest)(postError, 2), false);
    strict_1.default.equal((0, types_1.shouldRetryRequest)(forcedPostError, 2), true);
});
(0, node_test_1.default)('toApiClientError maps server codes and statuses into app error codes', () => {
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
    };
    const apiError = (0, types_1.toApiClientError)(error);
    strict_1.default.equal(apiError.code, appError_1.APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED);
    strict_1.default.equal(apiError.status, 403);
    strict_1.default.equal(apiError.sourceCode, 'PAIRING_REQUIRED');
});
