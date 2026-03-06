"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mmkvZustandStorage = void 0;
const storage_1 = require("./storage");
exports.mmkvZustandStorage = {
    getItem: (name) => storage_1.appStorage.getString(name) ?? null,
    setItem: (name, value) => {
        storage_1.appStorage.set(name, value);
    },
    removeItem: (name) => {
        storage_1.appStorage.remove(name);
    },
};
