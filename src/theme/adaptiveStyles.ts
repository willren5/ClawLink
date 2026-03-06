import {
  Appearance,
  DynamicColorIOS,
  Platform,
  StyleSheet,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
  useColorScheme,
} from 'react-native';

import { DEFAULT_ACCENT_COLOR, normalizeAccentColor, useAppPreferencesStore } from '../features/settings/store/preferencesStore';

export type ThemeMode = 'light' | 'dark';

type NamedStyles<T> = {
  [P in keyof T]: ViewStyle | TextStyle | ImageStyle;
};

type ColorValueLike = string | ReturnType<typeof DynamicColorIOS>;

const LIGHT_COLOR_MAP: Record<string, string> = {
  '#020617': '#FFFFFF',
  '#020617CC': 'rgba(255,255,255,0.92)',
  '#0B1220': '#FFF8FB',
  '#0C4A6E': '#FFEFF4',
  '#0EA5E9': '#264653',
  '#0F172A': '#F7FAFB',
  '#0F766E': '#2A9D8F',
  '#10B981': '#2A9D8F',
  '#111827': '#F7FAFB',
  '#14B8A6': '#2A9D8F',
  '#1C1917': '#F3ECE4',
  '#1D4ED8': '#264653',
  '#1E293B': '#264653',
  '#1E3A8A': '#264653',
  '#1E40AF': '#264653',
  '#1F1111': '#FFF1F4',
  '#1F2937': '#2D4E5C',
  '#22C55E': '#2A9D8F',
  '#22D3EE': '#FFCAD4',
  '#2563EB': '#264653',
  '#334155': '#607781',
  '#34D399': '#2A9D8F',
  '#374151': '#6B7D86',
  '#38BDF8': '#264653',
  '#3B82F6': '#264653',
  '#60A5FA': '#264653',
  '#64748B': '#4E6471',
  '#6B7280': '#536A75',
  '#7C2D12': '#C06C2A',
  '#7F1D1D': '#B23A48',
  '#93C5FD': '#264653',
  '#94A3B8': '#4E6370',
  '#991B1B': '#B23A48',
  '#9CA3AF': '#536B76',
  '#A7F3D0': '#2F6B58',
  '#BFDBFE': '#315564',
  '#CBD5E1': '#38545F',
  '#DBEAFE': '#315564',
  '#E0F2FE': '#315564',
  '#E2E8F0': '#264653',
  '#EF4444': '#C23E57',
  '#EFF6FF': '#45616E',
  '#F59E0B': '#A56C00',
  '#F87171': '#C85765',
  '#F8FAFC': '#264653',
  '#FBBF24': '#B67A00',
  '#FCA5A5': '#9E3043',
  '#FDE68A': '#7A5A00',
  '#FECACA': '#8F2C3B',
  '#06B6D4': '#FFCAD4',
};

const DARK_COLOR_MAP: Record<string, string> = {
  '#020617': '#000000',
  '#020617CC': 'rgba(0,0,0,0.92)',
  '#0B1220': '#0B0B0B',
  '#0C4A6E': '#533326',
  '#0EA5E9': '#CAFFF5',
  '#0F172A': '#121212',
  '#0F766E': '#6EE7C8',
  '#10B981': '#6EE7C8',
  '#111827': '#121212',
  '#14B8A6': '#6EE7C8',
  '#1C1917': '#18120F',
  '#1D4ED8': '#533326',
  '#1E293B': '#CAFFF5',
  '#1E3A8A': '#533326',
  '#1E40AF': '#533326',
  '#1F1111': '#2A1519',
  '#1F2937': '#17201F',
  '#22C55E': '#6EE7C8',
  '#22D3EE': '#CAFFF5',
  '#2563EB': '#533326',
  '#334155': '#43635D',
  '#34D399': '#6EE7C8',
  '#374151': '#47605A',
  '#38BDF8': '#CAFFF5',
  '#3B82F6': '#CAFFF5',
  '#60A5FA': '#CAFFF5',
  '#64748B': '#8DAEA8',
  '#6B7280': '#8FA5A1',
  '#7C2D12': '#8C5C2D',
  '#7F1D1D': '#D58293',
  '#93C5FD': '#CAFFF5',
  '#94A3B8': '#9CC4BD',
  '#991B1B': '#D58293',
  '#9CA3AF': '#A2BBB5',
  '#A7F3D0': '#7FCAB7',
  '#BFDBFE': '#9DCFC5',
  '#CBD5E1': '#5A746F',
  '#DBEAFE': '#A4D8CC',
  '#E0F2FE': '#A9DDD1',
  '#E2E8F0': '#CAFFF5',
  '#EF4444': '#FF8EA2',
  '#EFF6FF': '#9CCFC4',
  '#F59E0B': '#E3B45F',
  '#F87171': '#F0A2B2',
  '#F8FAFC': '#F2FFF9',
  '#FBBF24': '#E8C372',
  '#FCA5A5': '#F2AFBF',
  '#FDE68A': '#8C7440',
  '#FECACA': '#B98090',
  '#06B6D4': '#CAFFF5',
};

const COLOR_PROPERTY_REGEX = /color/i;

function normalizeHex(value: string): string {
  return value.trim().toUpperCase();
}

function resolveMode(preference: 'system' | ThemeMode = 'system', colorScheme = Appearance.getColorScheme()): ThemeMode {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  return colorScheme === 'dark' ? 'dark' : 'light';
}

function mapColorByMode(input: string, mode: ThemeMode): string {
  const key = normalizeHex(input);
  const table = mode === 'dark' ? DARK_COLOR_MAP : LIGHT_COLOR_MAP;
  return table[key] ?? input;
}

function mapColorAdaptive(input: string): ColorValueLike {
  const key = normalizeHex(input);
  const light = LIGHT_COLOR_MAP[key];
  const dark = DARK_COLOR_MAP[key];

  if (!light && !dark) {
    return input;
  }

  if (Platform.OS === 'ios') {
    return DynamicColorIOS({
      light: light ?? input,
      dark: dark ?? input,
    });
  }

  return mapColorByMode(input, resolveMode(useAppPreferencesStore.getState().themePreference));
}

function remapValue(value: unknown, propertyName: string): unknown {
  if (typeof value === 'string' && COLOR_PROPERTY_REGEX.test(propertyName)) {
    return mapColorAdaptive(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => remapValue(entry, propertyName));
  }

  if (value && typeof value === 'object') {
    return remapObject(value as Record<string, unknown>);
  }

  return value;
}

function remapObject(styleObject: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const [propertyName, value] of Object.entries(styleObject)) {
    next[propertyName] = remapValue(value, propertyName);
  }

  return next;
}

function remapNamedStyles<T extends NamedStyles<T> | NamedStyles<any>>(styles: T): T {
  const mapped: Record<string, unknown> = {};

  for (const [styleName, styleValue] of Object.entries(styles)) {
    mapped[styleName] = remapObject(styleValue as Record<string, unknown>);
  }

  return mapped as T;
}

export function createAdaptiveStyles<T extends NamedStyles<T> | NamedStyles<any>>(styles: T): T {
  return StyleSheet.create(remapNamedStyles(styles));
}

export function adaptiveColor(input: string): ColorValueLike {
  return mapColorAdaptive(input);
}

export function mapColorForMode(input: string, mode: ThemeMode): string {
  return mapColorByMode(input, mode);
}

export function useThemeMode(): ThemeMode {
  const colorScheme = useColorScheme();
  const themePreference = useAppPreferencesStore((state) => state.themePreference);
  return resolveMode(themePreference, colorScheme);
}

export function useAccentColor(): string {
  const accentColor = useAppPreferencesStore((state) => state.accentColor);
  return normalizeAccentColor(accentColor) ?? DEFAULT_ACCENT_COLOR;
}
