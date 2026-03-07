import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGatewayImport } from './connectionImport';

test('parses bootstrap terminal output into gateway fields', () => {
  const result = parseGatewayImport(`
    Gateway Host: 192.168.1.8
    Port: 18789
    API Token: ocg_live_token_123
  `);

  assert.deepEqual(result, {
    host: '192.168.1.8',
    port: 18789,
    token: 'ocg_live_token_123',
  });
});

test('drops token from clawlink connect deep links', () => {
  const result = parseGatewayImport(
    'clawlink://connect?host=gateway.local&port=443&token=abc123&tls=true&name=Office',
  );

  assert.deepEqual(result, {
    host: 'gateway.local',
    port: 443,
    tls: true,
    name: 'Office',
  });
});

test('parses JSON import payloads', () => {
  const result = parseGatewayImport(
    JSON.stringify({
      uri: 'https://gateway.example.com:8443',
      token: 'json-token',
      name: 'Prod',
    }),
  );

  assert.deepEqual(result, {
    host: 'gateway.example.com',
    port: 8443,
    tls: true,
    token: 'json-token',
    name: 'Prod',
  });
});
