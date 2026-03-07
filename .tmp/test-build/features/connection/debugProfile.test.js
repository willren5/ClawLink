"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const debugProfile_1 = require("./debugProfile");
function makeProfile(id, hidden = false) {
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
(0, node_test_1.default)('ensureHiddenDebugProfile removes hidden profile when feature is disabled', () => {
    const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '0';
    try {
        const profiles = (0, debugProfile_1.ensureHiddenDebugProfile)([
            makeProfile('gw_prod'),
            makeProfile(debugProfile_1.HIDDEN_DEBUG_PROFILE_ID, true),
        ]);
        strict_1.default.deepEqual(profiles.map((profile) => profile.id), ['gw_prod']);
    }
    finally {
        process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
    }
});
(0, node_test_1.default)('ensureHiddenDebugProfile appends hidden profile when feature is enabled', () => {
    const previous = process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE;
    process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = '1';
    try {
        const profiles = (0, debugProfile_1.ensureHiddenDebugProfile)([makeProfile('gw_prod')]);
        strict_1.default.equal(profiles.some((profile) => profile.id === debugProfile_1.HIDDEN_DEBUG_PROFILE_ID), true);
    }
    finally {
        process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE = previous;
    }
});
