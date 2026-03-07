"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const connectionRetryPolicy_1 = require("./connectionRetryPolicy");
(0, node_test_1.default)('allows only http to https transport upgrade retries', () => {
    const error = new Error('Network request failed');
    strict_1.default.equal((0, connectionRetryPolicy_1.shouldRetryWithTlsUpgrade)(false, error), true);
    strict_1.default.equal((0, connectionRetryPolicy_1.shouldRetryWithTlsUpgrade)(true, error), false);
});
(0, node_test_1.default)('does not retry transport upgrade on auth failures', () => {
    const error = new Error('HTTP 401: unauthorized');
    strict_1.default.equal((0, connectionRetryPolicy_1.isRetryableTransportError)(error), false);
    strict_1.default.equal((0, connectionRetryPolicy_1.shouldRetryWithTlsUpgrade)(false, error), false);
});
(0, node_test_1.default)('documents blocked https downgrade clearly', () => {
    strict_1.default.match((0, connectionRetryPolicy_1.buildTlsDowngradeBlockedMessage)(), /will not retry over insecure HTTP automatically/i);
});
