"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const incidentDefinitions_1 = require("./incidentDefinitions");
(0, node_test_1.default)('buildIncidentConditionKey falls back to alert type when dedupe key is absent', () => {
    strict_1.default.equal((0, incidentDefinitions_1.buildIncidentConditionKey)('disconnect_timeout'), 'disconnect_timeout');
    strict_1.default.equal((0, incidentDefinitions_1.buildIncidentConditionKey)('queue_backlog', ' backlog-main '), 'queue_backlog:backlog-main');
});
(0, node_test_1.default)('defaultDeepLinkForAlert maps each alert family to the expected destination', () => {
    strict_1.default.equal((0, incidentDefinitions_1.defaultDeepLinkForAlert)('disconnect_timeout'), 'clawlink://monitor');
    strict_1.default.equal((0, incidentDefinitions_1.defaultDeepLinkForAlert)('queue_backlog'), 'clawlink://chat');
    strict_1.default.equal((0, incidentDefinitions_1.defaultDeepLinkForAlert)('budget_exceeded'), 'clawlink://dashboard');
    strict_1.default.equal((0, incidentDefinitions_1.defaultDeepLinkForAlert)('agent_error'), 'clawlink://agents');
});
(0, node_test_1.default)('quickActionIdsForAlert exposes the reusable incident actions by alert type', () => {
    strict_1.default.deepEqual((0, incidentDefinitions_1.quickActionIdsForAlert)('disconnect_timeout'), ['reconnect_gateway', 'open_monitor']);
    strict_1.default.deepEqual((0, incidentDefinitions_1.quickActionIdsForAlert)('queue_backlog'), ['flush_queue', 'open_chat']);
    strict_1.default.deepEqual((0, incidentDefinitions_1.quickActionIdsForAlert)('budget_near_limit'), ['open_dashboard']);
    strict_1.default.deepEqual((0, incidentDefinitions_1.quickActionIdsForAlert)('agent_error'), ['refresh_agents', 'open_agents']);
});
(0, node_test_1.default)('describeAlertQuickActions localizes labels without changing action ids', () => {
    const zh = (0, incidentDefinitions_1.describeAlertQuickActions)('disconnect_timeout', 'zh');
    const en = (0, incidentDefinitions_1.describeAlertQuickActions)('disconnect_timeout', 'en');
    strict_1.default.deepEqual(zh.map((item) => item.id), ['reconnect_gateway', 'open_monitor']);
    strict_1.default.deepEqual(en.map((item) => item.id), ['reconnect_gateway', 'open_monitor']);
    strict_1.default.equal(zh[0]?.label, '立即重连');
    strict_1.default.equal(en[0]?.label, 'Reconnect');
});
