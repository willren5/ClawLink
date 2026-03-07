"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAppPreferencesStore = exports.DEFAULT_DASHBOARD_SECTION_ORDER = exports.DEFAULT_ACCENT_COLOR = exports.DEFAULT_THEME_PREFERENCE = exports.DEFAULT_APP_LANGUAGE = void 0;
exports.normalizeAccentColor = normalizeAccentColor;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
const storageKeys_1 = require("../../../constants/storageKeys");
const zustandStorage_1 = require("../../../lib/mmkv/zustandStorage");
const featureFlags_1 = require("../../../lib/features/featureFlags");
exports.DEFAULT_APP_LANGUAGE = 'zh';
exports.DEFAULT_THEME_PREFERENCE = 'system';
exports.DEFAULT_ACCENT_COLOR = '#264653';
exports.DEFAULT_DASHBOARD_SECTION_ORDER = [
    'volume',
    'tokenModels',
    'latency',
    'usage',
    'channels',
    'sessions',
];
const SHORT_HEX_REGEX = /^#([0-9a-fA-F]{3})$/;
const LONG_HEX_REGEX = /^#([0-9a-fA-F]{6})$/;
function normalizeAccentColor(input) {
    const value = input.trim();
    const shortHex = value.match(SHORT_HEX_REGEX);
    if (shortHex) {
        const [r, g, b] = shortHex[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    if (LONG_HEX_REGEX.test(value)) {
        return value.toUpperCase();
    }
    return null;
}
function sanitizeFeatureOverrides(input) {
    return Object.fromEntries(featureFlags_1.EXPERIMENTAL_FEATURE_KEYS.flatMap((key) => typeof input?.[key] === 'boolean' ? [[key, input[key]]] : []));
}
exports.useAppPreferencesStore = (0, zustand_1.create)()((0, middleware_1.persist)((set) => ({
    language: exports.DEFAULT_APP_LANGUAGE,
    themePreference: exports.DEFAULT_THEME_PREFERENCE,
    accentColor: exports.DEFAULT_ACCENT_COLOR,
    persistChatTranscripts: true,
    liveActivityEnabled: true,
    dynamicIslandEnabled: true,
    widgetEnabled: true,
    spotlightEnabled: false,
    featureOverrides: {},
    dashboardSectionOrder: [...exports.DEFAULT_DASHBOARD_SECTION_ORDER],
    isHydrated: false,
    setLanguage: (language) => {
        set({ language });
    },
    setThemePreference: (themePreference) => {
        set({ themePreference });
    },
    setAccentColor: (value) => {
        const normalized = normalizeAccentColor(value);
        if (!normalized) {
            return;
        }
        set({ accentColor: normalized });
    },
    setPersistChatTranscripts: (persistChatTranscripts) => {
        set({ persistChatTranscripts });
    },
    setLiveActivityEnabled: (enabled) => {
        set({ liveActivityEnabled: enabled });
    },
    setDynamicIslandEnabled: (enabled) => {
        set({ dynamicIslandEnabled: enabled });
    },
    setWidgetEnabled: (enabled) => {
        set({ widgetEnabled: enabled });
    },
    setSpotlightEnabled: (enabled) => {
        set({ spotlightEnabled: enabled });
    },
    setExperimentalFeatureEnabled: (key, enabled) => {
        set((state) => ({
            featureOverrides: {
                ...state.featureOverrides,
                [key]: enabled,
            },
        }));
    },
    resetExperimentalFeatures: () => {
        set({ featureOverrides: {} });
    },
    moveDashboardSection: (section, direction) => {
        set((state) => {
            const current = state.dashboardSectionOrder.length
                ? [...state.dashboardSectionOrder]
                : [...exports.DEFAULT_DASHBOARD_SECTION_ORDER];
            const index = current.indexOf(section);
            if (index === -1) {
                return {};
            }
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= current.length) {
                return {};
            }
            const next = [...current];
            [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
            return { dashboardSectionOrder: next };
        });
    },
    resetDashboardSectionOrder: () => {
        set({ dashboardSectionOrder: [...exports.DEFAULT_DASHBOARD_SECTION_ORDER] });
    },
    resetAppearance: () => {
        set({
            themePreference: exports.DEFAULT_THEME_PREFERENCE,
            accentColor: exports.DEFAULT_ACCENT_COLOR,
        });
    },
    resetAllPreferences: () => {
        set({
            language: exports.DEFAULT_APP_LANGUAGE,
            themePreference: exports.DEFAULT_THEME_PREFERENCE,
            accentColor: exports.DEFAULT_ACCENT_COLOR,
            persistChatTranscripts: true,
            liveActivityEnabled: true,
            dynamicIslandEnabled: true,
            widgetEnabled: true,
            spotlightEnabled: false,
            featureOverrides: {},
            dashboardSectionOrder: [...exports.DEFAULT_DASHBOARD_SECTION_ORDER],
        });
    },
}), {
    name: storageKeys_1.STORAGE_KEYS.APP_PREFERENCES_STORE,
    storage: (0, middleware_1.createJSONStorage)(() => zustandStorage_1.mmkvZustandStorage),
    partialize: (state) => ({
        language: state.language,
        themePreference: state.themePreference,
        accentColor: state.accentColor,
        persistChatTranscripts: state.persistChatTranscripts,
        liveActivityEnabled: state.liveActivityEnabled,
        dynamicIslandEnabled: state.dynamicIslandEnabled,
        widgetEnabled: state.widgetEnabled,
        spotlightEnabled: state.spotlightEnabled,
        featureOverrides: state.featureOverrides,
        dashboardSectionOrder: state.dashboardSectionOrder,
    }),
    onRehydrateStorage: () => () => {
        const state = exports.useAppPreferencesStore.getState();
        const dedupedOrder = (Array.isArray(state.dashboardSectionOrder) ? state.dashboardSectionOrder : [])
            .filter((item, index, source) => {
            return exports.DEFAULT_DASHBOARD_SECTION_ORDER.includes(item) && source.indexOf(item) === index;
        });
        const themePreference = state.themePreference === 'light' || state.themePreference === 'dark' ? state.themePreference : 'system';
        exports.useAppPreferencesStore.setState({
            language: state.language === 'en' ? 'en' : 'zh',
            themePreference,
            accentColor: normalizeAccentColor(state.accentColor) ?? exports.DEFAULT_ACCENT_COLOR,
            persistChatTranscripts: state.persistChatTranscripts !== false,
            liveActivityEnabled: state.liveActivityEnabled !== false,
            dynamicIslandEnabled: state.dynamicIslandEnabled !== false,
            widgetEnabled: state.widgetEnabled !== false,
            spotlightEnabled: state.spotlightEnabled === true,
            featureOverrides: sanitizeFeatureOverrides(state.featureOverrides),
            dashboardSectionOrder: dedupedOrder.length > 0 ? dedupedOrder : [...exports.DEFAULT_DASHBOARD_SECTION_ORDER],
            isHydrated: true,
        });
    },
}));
