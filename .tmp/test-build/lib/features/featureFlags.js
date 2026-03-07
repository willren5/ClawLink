"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPERIMENTAL_FEATURE_KEYS = void 0;
exports.parseFeatureOverrides = parseFeatureOverrides;
exports.getDefaultExperimentalFeatureFlags = getDefaultExperimentalFeatureFlags;
exports.resolveExperimentalFeatureFlags = resolveExperimentalFeatureFlags;
exports.isExperimentalFeatureEnabled = isExperimentalFeatureEnabled;
exports.isHiddenDebugProfileEnabled = isHiddenDebugProfileEnabled;
exports.EXPERIMENTAL_FEATURE_KEYS = [
    'healthBridge',
    'shortcutIntents',
    'reasoningTimeline',
    'chatImageCarousel',
    'agentLogsPagination',
];
function readDevFlag() {
    const globalValue = globalThis;
    return globalValue.__DEV__ === true;
}
function parseBoolean(value) {
    if (value === '1' || value?.toLowerCase() === 'true') {
        return true;
    }
    if (value === '0' || value?.toLowerCase() === 'false') {
        return false;
    }
    return undefined;
}
function parseFeatureOverrides(raw) {
    if (!raw?.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return Object.fromEntries(exports.EXPERIMENTAL_FEATURE_KEYS.flatMap((key) => typeof parsed[key] === 'boolean' ? [[key, parsed[key]]] : []));
    }
    catch {
        return {};
    }
}
function getDefaultExperimentalFeatureFlags() {
    const envOverrides = parseFeatureOverrides(process.env.EXPO_PUBLIC_FEATURE_FLAGS);
    return {
        healthBridge: envOverrides.healthBridge ?? true,
        shortcutIntents: envOverrides.shortcutIntents ?? true,
        reasoningTimeline: envOverrides.reasoningTimeline ?? true,
        chatImageCarousel: envOverrides.chatImageCarousel ?? true,
        agentLogsPagination: envOverrides.agentLogsPagination ?? true,
    };
}
function resolveExperimentalFeatureFlags(overrides = {}) {
    const defaults = getDefaultExperimentalFeatureFlags();
    return {
        healthBridge: overrides.healthBridge ?? defaults.healthBridge,
        shortcutIntents: overrides.shortcutIntents ?? defaults.shortcutIntents,
        reasoningTimeline: overrides.reasoningTimeline ?? defaults.reasoningTimeline,
        chatImageCarousel: overrides.chatImageCarousel ?? defaults.chatImageCarousel,
        agentLogsPagination: overrides.agentLogsPagination ?? defaults.agentLogsPagination,
    };
}
function isExperimentalFeatureEnabled(key, overrides = {}) {
    return resolveExperimentalFeatureFlags(overrides)[key];
}
function isHiddenDebugProfileEnabled() {
    const explicit = parseBoolean(process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE);
    if (typeof explicit === 'boolean') {
        return explicit;
    }
    return readDevFlag();
}
