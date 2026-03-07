import { NativeModules, Platform } from 'react-native';

import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { getVisibleGatewayProfiles } from '../../connection/debugProfile';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import { resolveFocusFilterPolicy } from './focusFilter';

interface ClawSpotlightBridgeModule {
  indexSpotlightItems?: (payload: string) => Promise<number>;
  clearSpotlightIndex?: () => Promise<void>;
}

const INDEX_DEBOUNCE_MS = 1200;
const INDEX_MIN_INTERVAL_MS = 30_000;
const nativeBridge = NativeModules.ClawSurfaceBridge as ClawSpotlightBridgeModule | undefined;

function buildSpotlightPayload(): {
  gateways: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  sessions: Array<{ id: string; title: string }>;
} {
  const gateways = getVisibleGatewayProfiles(useConnectionStore.getState().profiles).map((profile) => ({
    id: profile.id,
    name: profile.name,
  }));

  const agents = Object.values(useAgentsRuntimeStore.getState().byId)
    .map((agent) => ({
      id: agent.id,
      name: agent.name || agent.id,
    }))
    .slice(0, 40);

  const sessions = Object.values(useChatStore.getState().sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 60)
    .map((session) => ({
      id: session.id,
      title: session.title || session.id,
    }));

  return {
    gateways,
    agents,
    sessions,
  };
}

export function startSpotlightIndexing(): () => void {
  if (Platform.OS !== 'ios' || !nativeBridge?.indexSpotlightItems) {
    return () => {};
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastPayloadHash = '';
  let lastIndexedAt = 0;
  let indexCleared = false;

  const schedule = (): void => {
    if (stopped) {
      return;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const delayMs = Math.max(
      INDEX_DEBOUNCE_MS,
      Math.max(0, INDEX_MIN_INTERVAL_MS - (Date.now() - lastIndexedAt)),
    );

    timeoutId = setTimeout(() => {
      timeoutId = null;
      void (async () => {
        const policy = await resolveFocusFilterPolicy();
        const spotlightEnabled = useAppPreferencesStore.getState().spotlightEnabled;
        if (!spotlightEnabled || !policy.allowSpotlight) {
          if (!indexCleared) {
            lastPayloadHash = '';
            indexCleared = true;
            lastIndexedAt = Date.now();
            await nativeBridge.clearSpotlightIndex?.();
          }
          return;
        }

        const payload = buildSpotlightPayload();
        const payloadHash = JSON.stringify(payload);
        if (payloadHash === lastPayloadHash) {
          return;
        }

        lastPayloadHash = payloadHash;
        indexCleared = false;
        lastIndexedAt = Date.now();
        if (payload.gateways.length === 0 && payload.agents.length === 0 && payload.sessions.length === 0) {
          await nativeBridge.clearSpotlightIndex?.();
          return;
        }

        await nativeBridge.indexSpotlightItems?.(payloadHash);
      })().catch(() => {
        // Spotlight indexing is best effort.
      });
    }, delayMs);
  };

  const unsubscribers = [
    useConnectionStore.subscribe(schedule),
    useAgentsRuntimeStore.subscribe(schedule),
    useChatStore.subscribe(schedule),
    useAppPreferencesStore.subscribe(schedule),
  ];

  schedule();

  return () => {
    stopped = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastPayloadHash = '';
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
