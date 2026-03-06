"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appStorage = void 0;
exports.setString = setString;
exports.getString = getString;
exports.setNumber = setNumber;
exports.getNumber = getNumber;
exports.setBoolean = setBoolean;
exports.getBoolean = getBoolean;
exports.setObject = setObject;
exports.getObject = getObject;
exports.removeItem = removeItem;
exports.clearAllStorage = clearAllStorage;
const react_native_mmkv_1 = require("react-native-mmkv");
exports.appStorage = (0, react_native_mmkv_1.createMMKV)({
    id: 'claw-link-mmkv',
    encryptionKey: 'claw-link-local-cache-v1',
});
function setString(key, value) {
    exports.appStorage.set(key, value);
}
function getString(key) {
    return exports.appStorage.getString(key);
}
function setNumber(key, value) {
    exports.appStorage.set(key, value);
}
function getNumber(key) {
    return exports.appStorage.getNumber(key);
}
function setBoolean(key, value) {
    exports.appStorage.set(key, value);
}
function getBoolean(key) {
    return exports.appStorage.getBoolean(key);
}
function setObject(key, value) {
    exports.appStorage.set(key, JSON.stringify(value));
}
function getObject(key) {
    const raw = exports.appStorage.getString(key);
    if (!raw) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function removeItem(key) {
    exports.appStorage.remove(key);
}
function clearAllStorage() {
    exports.appStorage.clearAll();
}
