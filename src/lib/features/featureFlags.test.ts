import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHiddenDebugProfileEnabled,
  parseFeatureOverrides,
  resolveExperimentalFeatureFlags,
} from './featureFlags';

test('parseFeatureOverrides ignores invalid payloads and keeps known boolean flags', () => {
  assert.deepEqual(
    parseFeatureOverrides('{"healthBridge":false,"chatImageCarousel":true,"unknown":true}'),
    {
      healthBridge: false,
      chatImageCarousel: true,
    },
  );
  assert.deepEqual(parseFeatureOverrides('not-json'), {});
});

test('resolveExperimentalFeatureFlags merges build defaults with local overrides', () => {
  const previous = process.env.EXPO_PUBLIC_FEATURE_FLAGS;
  process.env.EXPO_PUBLIC_FEATURE_FLAGS = '{"healthBridge":false,"shortcutIntents":true}';

  try {
    assert.deepEqual(resolveExperimentalFeatureFlags({ shortcutIntents: false }), {
      healthBridge: false,
      shortcutIntents: false,
      reasoningTimeline: true,
      chatImageCarousel: true,
      agentLogsPagination: true,
    });
  } finally {
    process.env.EXPO_PUBLIC_FEATURE_FLAGS = previous;
  }
});

test('isHiddenDebugProfileEnabled honors explicit env override', () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;

  try {
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '0';
    assert.equal(isHiddenDebugProfileEnabled(), false);

    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '1';
    assert.equal(isHiddenDebugProfileEnabled(), true);
  } finally {
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
  }
});
