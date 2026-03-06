import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

export type AppLanguage = 'zh' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type DashboardSectionKey =
  | 'volume'
  | 'tokenModels'
  | 'latency'
  | 'usage'
  | 'channels'
  | 'sessions';

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'zh';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const DEFAULT_ACCENT_COLOR = '#264653';
export const DEFAULT_DASHBOARD_SECTION_ORDER: DashboardSectionKey[] = [
  'volume',
  'tokenModels',
  'latency',
  'usage',
  'channels',
  'sessions',
];

const SHORT_HEX_REGEX = /^#([0-9a-fA-F]{3})$/;
const LONG_HEX_REGEX = /^#([0-9a-fA-F]{6})$/;

export function normalizeAccentColor(input: string): string | null {
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

interface AppPreferencesStoreState {
  language: AppLanguage;
  themePreference: ThemePreference;
  accentColor: string;
  liveActivityEnabled: boolean;
  dynamicIslandEnabled: boolean;
  widgetEnabled: boolean;
  dashboardSectionOrder: DashboardSectionKey[];
  isHydrated: boolean;
  setLanguage: (language: AppLanguage) => void;
  setThemePreference: (value: ThemePreference) => void;
  setAccentColor: (value: string) => void;
  setLiveActivityEnabled: (enabled: boolean) => void;
  setDynamicIslandEnabled: (enabled: boolean) => void;
  setWidgetEnabled: (enabled: boolean) => void;
  moveDashboardSection: (section: DashboardSectionKey, direction: 'up' | 'down') => void;
  resetDashboardSectionOrder: () => void;
  resetAppearance: () => void;
  resetAllPreferences: () => void;
}

export const useAppPreferencesStore = create<AppPreferencesStoreState>()(
  persist(
    (set) => ({
      language: DEFAULT_APP_LANGUAGE,
      themePreference: DEFAULT_THEME_PREFERENCE,
      accentColor: DEFAULT_ACCENT_COLOR,
      liveActivityEnabled: true,
      dynamicIslandEnabled: true,
      widgetEnabled: true,
      dashboardSectionOrder: [...DEFAULT_DASHBOARD_SECTION_ORDER],
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
      setLiveActivityEnabled: (enabled) => {
        set({ liveActivityEnabled: enabled });
      },
      setDynamicIslandEnabled: (enabled) => {
        set({ dynamicIslandEnabled: enabled });
      },
      setWidgetEnabled: (enabled) => {
        set({ widgetEnabled: enabled });
      },
      moveDashboardSection: (section, direction) => {
        set((state) => {
          const current = state.dashboardSectionOrder.length
            ? [...state.dashboardSectionOrder]
            : [...DEFAULT_DASHBOARD_SECTION_ORDER];
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
        set({ dashboardSectionOrder: [...DEFAULT_DASHBOARD_SECTION_ORDER] });
      },
      resetAppearance: () => {
        set({
          themePreference: DEFAULT_THEME_PREFERENCE,
          accentColor: DEFAULT_ACCENT_COLOR,
        });
      },
      resetAllPreferences: () => {
        set({
          language: DEFAULT_APP_LANGUAGE,
          themePreference: DEFAULT_THEME_PREFERENCE,
          accentColor: DEFAULT_ACCENT_COLOR,
          liveActivityEnabled: true,
          dynamicIslandEnabled: true,
          widgetEnabled: true,
          dashboardSectionOrder: [...DEFAULT_DASHBOARD_SECTION_ORDER],
        });
      },
    }),
    {
      name: STORAGE_KEYS.APP_PREFERENCES_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        language: state.language,
        themePreference: state.themePreference,
        accentColor: state.accentColor,
        liveActivityEnabled: state.liveActivityEnabled,
        dynamicIslandEnabled: state.dynamicIslandEnabled,
        widgetEnabled: state.widgetEnabled,
        dashboardSectionOrder: state.dashboardSectionOrder,
      }),
      onRehydrateStorage: () => () => {
        const state = useAppPreferencesStore.getState();
        const dedupedOrder = (Array.isArray(state.dashboardSectionOrder) ? state.dashboardSectionOrder : [])
          .filter((item, index, source): item is DashboardSectionKey => {
            return DEFAULT_DASHBOARD_SECTION_ORDER.includes(item) && source.indexOf(item) === index;
          });
        const themePreference: ThemePreference =
          state.themePreference === 'light' || state.themePreference === 'dark' ? state.themePreference : 'system';
        useAppPreferencesStore.setState({
          language: state.language === 'en' ? 'en' : 'zh',
          themePreference,
          accentColor: normalizeAccentColor(state.accentColor) ?? DEFAULT_ACCENT_COLOR,
          dashboardSectionOrder:
            dedupedOrder.length > 0 ? dedupedOrder : [...DEFAULT_DASHBOARD_SECTION_ORDER],
          isHydrated: true,
        });
      },
    },
  ),
);
