"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const featureFlags_1 = require("./featureFlags");
(0, node_test_1.default)('parseFeatureOverrides ignores invalid payloads and keeps known boolean flags', () => {
    strict_1.default.deepEqual((0, featureFlags_1.parseFeatureOverrides)('{"healthBridge":false,"chatImageCarousel":true,"unknown":true}'), {
        healthBridge: false,
        chatImageCarousel: true,
    });
    strict_1.default.deepEqual((0, featureFlags_1.parseFeatureOverrides)('not-json'), {});
});
(0, node_test_1.default)('resolveExperimentalFeatureFlags merges build defaults with local overrides', () => {
    const previous = process.env.EXPO_PUBLIC_FEATURE_FLAGS;
    process.env.EXPO_PUBLIC_FEATURE_FLAGS = '{"healthBridge":false,"shortcutIntents":true}';
    try {
        strict_1.default.deepEqual((0, featureFlags_1.resolveExperimentalFeatureFlags)({ shortcutIntents: false }), {
            healthBridge: false,
            shortcutIntents: false,
            reasoningTimeline: true,
            chatImageCarousel: true,
            agentLogsPagination: true,
        });
    }
    finally {
        process.env.EXPO_PUBLIC_FEATURE_FLAGS = previous;
    }
});
(0, node_test_1.default)('isHiddenDebugProfileEnabled honors explicit env override', () => {
    const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;
    try {
        process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '0';
        strict_1.default.equal((0, featureFlags_1.isHiddenDebugProfileEnabled)(), false);
        process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '1';
        strict_1.default.equal((0, featureFlags_1.isHiddenDebugProfileEnabled)(), true);
    }
    finally {
        process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
    }
});
