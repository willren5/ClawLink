export const EXPERIMENTAL_FEATURE_KEYS = [
  'healthBridge',
  'shortcutIntents',
  'reasoningTimeline',
  'chatImageCarousel',
  'agentLogsPagination',
] as const;

export type ExperimentalFeatureKey = (typeof EXPERIMENTAL_FEATURE_KEYS)[number];

export type FeatureOverrides = Partial<Record<ExperimentalFeatureKey, boolean>>;

function readDevFlag(): boolean {
  const globalValue = globalThis as { __DEV__?: boolean };
  return globalValue.__DEV__ === true;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === '1' || value?.toLowerCase() === 'true') {
    return true;
  }
  if (value === '0' || value?.toLowerCase() === 'false') {
    return false;
  }
  return undefined;
}

export function parseFeatureOverrides(
  raw: string | undefined,
): FeatureOverrides {
  if (!raw?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      EXPERIMENTAL_FEATURE_KEYS.flatMap((key) =>
        typeof parsed[key] === 'boolean' ? [[key, parsed[key]]] : [],
      ),
    ) as FeatureOverrides;
  } catch {
    return {};
  }
}

export function getDefaultExperimentalFeatureFlags(): Record<ExperimentalFeatureKey, boolean> {
  const envOverrides = parseFeatureOverrides(process.env.EXPO_PUBLIC_FEATURE_FLAGS);
  return {
    healthBridge: envOverrides.healthBridge ?? true,
    shortcutIntents: envOverrides.shortcutIntents ?? true,
    reasoningTimeline: envOverrides.reasoningTimeline ?? true,
    chatImageCarousel: envOverrides.chatImageCarousel ?? true,
    agentLogsPagination: envOverrides.agentLogsPagination ?? true,
  };
}

export function resolveExperimentalFeatureFlags(
  overrides: FeatureOverrides = {},
): Record<ExperimentalFeatureKey, boolean> {
  const defaults = getDefaultExperimentalFeatureFlags();
  return {
    healthBridge: overrides.healthBridge ?? defaults.healthBridge,
    shortcutIntents: overrides.shortcutIntents ?? defaults.shortcutIntents,
    reasoningTimeline: overrides.reasoningTimeline ?? defaults.reasoningTimeline,
    chatImageCarousel: overrides.chatImageCarousel ?? defaults.chatImageCarousel,
    agentLogsPagination: overrides.agentLogsPagination ?? defaults.agentLogsPagination,
  };
}

export function isExperimentalFeatureEnabled(
  key: ExperimentalFeatureKey,
  overrides: FeatureOverrides = {},
): boolean {
  return resolveExperimentalFeatureFlags(overrides)[key];
}

export function isHiddenDebugProfileEnabled(): boolean {
  const explicit = parseBoolean(process.env.EXPO_PUBLIC_ENABLE_HIDDEN_DEBUG_PROFILE);
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  return readDevFlag();
}
