import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGatewayImport } from './connectionImport';
import { buildGatewayFullSetupBundle, buildGatewayInviteBundle } from './gatewayInvite';

test('invite bundle round-trips through smart import without token', () => {
  const payload = buildGatewayInviteBundle({
    host: 'gateway.example.com',
    port: 443,
    tls: true,
    name: 'Office',
  });

  assert.deepEqual(parseGatewayImport(payload), {
    host: 'gateway.example.com',
    port: 443,
    tls: true,
    name: 'Office',
  });
});

test('full setup bundle round-trips through smart import with token', () => {
  const payload = buildGatewayFullSetupBundle(
    {
      host: '192.168.1.8',
      port: 18789,
      tls: false,
      name: 'Home',
    },
    'ocg_live_token_123',
  );

  assert.deepEqual(parseGatewayImport(payload), {
    host: '192.168.1.8',
    port: 18789,
    tls: false,
    token: 'ocg_live_token_123',
    name: 'Home',
  });
});
