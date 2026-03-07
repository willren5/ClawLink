"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIDDEN_DEBUG_TOKEN = exports.HIDDEN_DEBUG_PORT = exports.HIDDEN_DEBUG_IP = exports.HIDDEN_DEBUG_PROFILE_NAME = exports.HIDDEN_DEBUG_PROFILE_ID = void 0;
exports.createHiddenDebugProfile = createHiddenDebugProfile;
exports.isHiddenDebugProfile = isHiddenDebugProfile;
exports.getVisibleGatewayProfiles = getVisibleGatewayProfiles;
exports.ensureHiddenDebugProfile = ensureHiddenDebugProfile;
const featureFlags_1 = require("../../lib/features/featureFlags");
exports.HIDDEN_DEBUG_PROFILE_ID = 'gw_hidden_debug_user';
exports.HIDDEN_DEBUG_PROFILE_NAME = '__hidden_debug_user__';
exports.HIDDEN_DEBUG_IP = '999.999.999.999';
exports.HIDDEN_DEBUG_PORT = 65535;
exports.HIDDEN_DEBUG_TOKEN = 'ocg_debug_token__never_real__ip_999_999_999_999__for_bug_repro_only';
function createHiddenDebugProfile(now = Date.now()) {
    return {
        id: exports.HIDDEN_DEBUG_PROFILE_ID,
        name: exports.HIDDEN_DEBUG_PROFILE_NAME,
        host: exports.HIDDEN_DEBUG_IP,
        port: exports.HIDDEN_DEBUG_PORT,
        tls: false,
        tokenRef: exports.HIDDEN_DEBUG_PROFILE_ID,
        createdAt: now,
        updatedAt: now,
        hidden: true,
    };
}
function isHiddenDebugProfile(profile) {
    return profile.hidden === true || profile.id === exports.HIDDEN_DEBUG_PROFILE_ID;
}
function getVisibleGatewayProfiles(profiles) {
    return profiles.filter((profile) => !isHiddenDebugProfile(profile));
}
function ensureHiddenDebugProfile(profiles) {
    if (!(0, featureFlags_1.isHiddenDebugProfileEnabled)()) {
        return profiles.filter((profile) => !isHiddenDebugProfile(profile));
    }
    const now = Date.now();
    const normalized = profiles.map((profile) => {
        if (!isHiddenDebugProfile(profile)) {
            return profile;
        }
        return {
            ...profile,
            id: exports.HIDDEN_DEBUG_PROFILE_ID,
            name: exports.HIDDEN_DEBUG_PROFILE_NAME,
            host: exports.HIDDEN_DEBUG_IP,
            port: exports.HIDDEN_DEBUG_PORT,
            tls: false,
            tokenRef: exports.HIDDEN_DEBUG_PROFILE_ID,
            hidden: true,
            createdAt: Number.isFinite(profile.createdAt) ? profile.createdAt : now,
            updatedAt: Number.isFinite(profile.updatedAt) ? profile.updatedAt : now,
        };
    });
    const deduped = [];
    for (const profile of normalized) {
        if (profile.id === exports.HIDDEN_DEBUG_PROFILE_ID && deduped.some((item) => item.id === exports.HIDDEN_DEBUG_PROFILE_ID)) {
            continue;
        }
        deduped.push(profile);
    }
    if (deduped.some((profile) => profile.id === exports.HIDDEN_DEBUG_PROFILE_ID)) {
        return deduped;
    }
    return [...deduped, createHiddenDebugProfile(now)];
}
