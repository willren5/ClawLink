import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIncidentConditionKey,
  defaultDeepLinkForAlert,
  describeAlertQuickActions,
  quickActionIdsForAlert,
} from './incidentDefinitions';

test('buildIncidentConditionKey falls back to alert type when dedupe key is absent', () => {
  assert.equal(buildIncidentConditionKey('disconnect_timeout'), 'disconnect_timeout');
  assert.equal(buildIncidentConditionKey('queue_backlog', ' backlog-main '), 'queue_backlog:backlog-main');
});

test('defaultDeepLinkForAlert maps each alert family to the expected destination', () => {
  assert.equal(defaultDeepLinkForAlert('disconnect_timeout'), 'clawlink://monitor');
  assert.equal(defaultDeepLinkForAlert('queue_backlog'), 'clawlink://chat');
  assert.equal(defaultDeepLinkForAlert('budget_exceeded'), 'clawlink://dashboard');
  assert.equal(defaultDeepLinkForAlert('agent_error'), 'clawlink://agents');
});

test('quickActionIdsForAlert exposes the reusable incident actions by alert type', () => {
  assert.deepEqual(quickActionIdsForAlert('disconnect_timeout'), ['reconnect_gateway', 'open_monitor']);
  assert.deepEqual(quickActionIdsForAlert('queue_backlog'), ['flush_queue', 'open_chat']);
  assert.deepEqual(quickActionIdsForAlert('budget_near_limit'), ['open_dashboard']);
  assert.deepEqual(quickActionIdsForAlert('agent_error'), ['refresh_agents', 'open_agents']);
});

test('describeAlertQuickActions localizes labels without changing action ids', () => {
  const zh = describeAlertQuickActions('disconnect_timeout', 'zh');
  const en = describeAlertQuickActions('disconnect_timeout', 'en');

  assert.deepEqual(
    zh.map((item) => item.id),
    ['reconnect_gateway', 'open_monitor'],
  );
  assert.deepEqual(
    en.map((item) => item.id),
    ['reconnect_gateway', 'open_monitor'],
  );
  assert.equal(zh[0]?.label, '立即重连');
  assert.equal(en[0]?.label, 'Reconnect');
});
