"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAuditLogStore = void 0;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
const storageKeys_1 = require("../../../constants/storageKeys");
const ringBuffer_1 = require("../../../lib/utils/ringBuffer");
const zustandStorage_1 = require("../../../lib/mmkv/zustandStorage");
const MAX_AUDIT_ENTRIES = 300;
function randomId() {
    return `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
exports.useAuditLogStore = (0, zustand_1.create)()((0, middleware_1.persist)((set) => ({
    entries: [],
    appendEntry: (entry) => {
        const payload = {
            id: randomId(),
            timestamp: entry.timestamp ?? Date.now(),
            action: entry.action,
            target: entry.target,
            result: entry.result,
            detail: entry.detail,
        };
        set((state) => ({
            entries: (0, ringBuffer_1.appendWithLimit)(state.entries, payload, MAX_AUDIT_ENTRIES),
        }));
    },
    clearEntries: () => {
        set({ entries: [] });
    },
}), {
    name: storageKeys_1.STORAGE_KEYS.AUDIT_LOG_STORE,
    storage: (0, middleware_1.createJSONStorage)(() => zustandStorage_1.mmkvZustandStorage),
    partialize: (state) => ({ entries: state.entries }),
}));
