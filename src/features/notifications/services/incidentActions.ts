import { getAgents } from '../../../lib/api';
import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useDashboardStore } from '../../dashboard/store/dashboardStore';
import { aggregateSystemSnapshot } from '../../system-surfaces/services/snapshotAggregator';
import { publishSystemSurfaces } from '../../system-surfaces/services/surfaceBridge';
import type { AlertQuickActionId } from '../types';

export async function refreshOperationalState(): Promise<void> {
  await Promise.allSettled([
    useConnectionStore.getState().pingActiveGateway(),
    useConnectionStore.getState().pollAllGateways(),
    useDashboardStore.getState().refresh(),
    getAgents().then((response) => {
      useAgentsRuntimeStore.getState().hydrateAgents(response.agents);
    }),
  ]);

  await publishSystemSurfaces(aggregateSystemSnapshot()).catch(() => undefined);
}

export async function executeAlertQuickAction(actionId: AlertQuickActionId): Promise<void> {
  switch (actionId) {
    case 'reconnect_gateway':
      await refreshOperationalState();
      return;
    case 'flush_queue':
      await useChatStore.getState().flushPendingQueue().catch(() => undefined);
      return;
    case 'refresh_agents':
      await refreshOperationalState();
      return;
    case 'open_monitor':
    case 'open_chat':
    case 'open_agents':
    case 'open_dashboard':
      return;
    default:
      return;
  }
}
