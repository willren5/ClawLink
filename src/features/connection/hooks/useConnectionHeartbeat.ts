import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useConnectionStore } from '../store/connectionStore';

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useConnectionHeartbeat(): void {
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const isHydrated = useConnectionStore((state) => state.isHydrated);
  const pingActiveGateway = useConnectionStore((state) => state.pingActiveGateway);
  const pollAllGateways = useConnectionStore((state) => state.pollAllGateways);

  useEffect(() => {
    if (!isHydrated || !activeProfileId) {
      return;
    }

    let appState: AppStateStatus = AppState.currentState;
    let timer: ReturnType<typeof setInterval> | null = null;

    const pingIfForeground = (): void => {
      if (appState === 'active') {
        void pingActiveGateway().catch(() => {
          // pingActiveGateway already updates store state on failures.
        });
        void pollAllGateways().catch(() => {
          // Background health checks are best-effort.
        });
      }
    };

    pingIfForeground();

    timer = setInterval(() => {
      pingIfForeground();
    }, HEARTBEAT_INTERVAL_MS);

    const sub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appState !== 'active';
      appState = nextState;

      if (wasBackground && nextState === 'active') {
        pingIfForeground();
      }
    });

    return () => {
      if (timer) {
        clearInterval(timer);
      }
      sub.remove();
    };
  }, [activeProfileId, isHydrated, pingActiveGateway, pollAllGateways]);
}
