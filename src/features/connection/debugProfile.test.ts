import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIDDEN_DEBUG_PROFILE_ID,
  ensureHiddenDebugProfile,
} from './debugProfile';
import type { GatewayProfile } from './types';

function makeProfile(id: string, hidden = false): GatewayProfile {
  return {
    id,
    name: id,
    host: '127.0.0.1',
    port: 18789,
    tls: false,
    tokenRef: id,
    createdAt: 1,
    updatedAt: 1,
    hidden,
  };
}

test('ensureHiddenDebugProfile removes hidden profile when feature is disabled', () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;
  process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '0';

  try {
    const profiles = ensureHiddenDebugProfile([
      makeProfile('gw_prod'),
      makeProfile(HIDDEN_DEBUG_PROFILE_ID, true),
    ]);

    assert.deepEqual(
      profiles.map((profile) => profile.id),
      ['gw_prod'],
    );
  } finally {
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
  }
});

test('ensureHiddenDebugProfile appends hidden profile when feature is enabled', () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;
  process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '1';

  try {
    const profiles = ensureHiddenDebugProfile([makeProfile('gw_prod')]);

    assert.equal(profiles.some((profile) => profile.id === HIDDEN_DEBUG_PROFILE_ID), true);
  } finally {
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
  }
});
