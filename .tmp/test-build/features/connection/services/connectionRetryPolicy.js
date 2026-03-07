"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRetryableTransportError = isRetryableTransportError;
exports.shouldRetryWithTlsUpgrade = shouldRetryWithTlsUpgrade;
exports.buildTlsDowngradeBlockedMessage = buildTlsDowngradeBlockedMessage;
function normalizeErrorText(error) {
    if (error instanceof Error) {
        return error.message.toLowerCase();
    }
    return String(error).toLowerCase();
}
function isRetryableTransportError(error) {
    const lowered = normalizeErrorText(error);
    if (lowered.includes('http 401') || lowered.includes('http 403')) {
        return false;
    }
    return (lowered.includes('network') ||
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
        lowered.includes('http 404'));
}
function shouldRetryWithTlsUpgrade(initialTls, error) {
    return !initialTls && isRetryableTransportError(error);
}
function buildTlsDowngradeBlockedMessage() {
    return 'Secure HTTPS connection failed. ClawLink will not retry over insecure HTTP automatically. Confirm the gateway protocol and retry explicitly if you intend to use HTTP.';
}
