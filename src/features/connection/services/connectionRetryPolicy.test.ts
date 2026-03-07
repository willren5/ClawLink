import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTlsDowngradeBlockedMessage,
  isRetryableTransportError,
  shouldRetryWithTlsUpgrade,
} from './connectionRetryPolicy';

test('allows only http to https transport upgrade retries', () => {
  const error = new Error('Network request failed');

  assert.equal(shouldRetryWithTlsUpgrade(false, error), true);
  assert.equal(shouldRetryWithTlsUpgrade(true, error), false);
});

test('does not retry transport upgrade on auth failures', () => {
  const error = new Error('HTTP 401: unauthorized');

  assert.equal(isRetryableTransportError(error), false);
  assert.equal(shouldRetryWithTlsUpgrade(false, error), false);
});

test('documents blocked https downgrade clearly', () => {
  assert.match(buildTlsDowngradeBlockedMessage(), /will not retry over insecure HTTP automatically/i);
});
