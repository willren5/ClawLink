import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { useChatStore } from '../../chat/store/chatStore';
import { useAgentActivityStore } from '../../chat/store/agentActivityStore';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useDashboardStore } from '../../dashboard/store/dashboardStore';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import {
  SYSTEM_SURFACE_SCHEMA_VERSION,
  type AgentActivitySummary,
  type SurfaceConnectionState,
  type SystemSurfaceSnapshot,
} from '../types';

const SNAPSHOT_DEBOUNCE_MS = 500;
const MAX_TASK_LENGTH = 60;

function mapConnectionState(
  status: 'connected' | 'connecting' | 'disconnected' | 'error',
): SurfaceConnectionState {
  if (status === 'connected') {
    return 'online';
  }
  if (status === 'connecting') {
    return 'degraded';
  }
  return 'offline';
}

function compactText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function deriveSubtitle(args: {
  language: 'zh' | 'en';
  connection: SurfaceConnectionState;
  activeSessions: number;
  pendingQueue: number;
  activeAgent: AgentActivitySummary | null;
}): string {
  if (args.activeAgent?.currentTask) {
    return `${args.activeAgent.agentName}: ${compactText(args.activeAgent.currentTask, MAX_TASK_LENGTH)}`;
  }

  if (args.connection === 'online') {
    return args.language === 'zh'
      ? `${args.activeSessions} 个会话 · ${args.pendingQueue} 个队列`
      : `${args.activeSessions} sessions · ${args.pendingQueue} queued`;
  }

  if (args.connection === 'degraded') {
    return args.language === 'zh' ? '正在重连 Gateway...' : 'Reconnecting to gateway...';
  }

  return args.language === 'zh' ? 'Gateway 离线' : 'Gateway offline';
}

function deriveIcon(connection: SurfaceConnectionState): string {
  if (connection === 'online') {
    return 'bolt.fill';
  }
  if (connection === 'degraded') {
    return 'arrow.triangle.2.circlepath';
  }
  return 'wifi.slash';
}

function countPendingMessages(
  messagesBySession: Record<string, Array<{ syncStatus: 'synced' | 'pending' | 'failed' | 'streaming' }>>,
  pendingQueueLength: number,
): number {
  let pendingCount = 0;

  for (const messages of Object.values(messagesBySession)) {
    for (const message of messages) {
      if (message.syncStatus === 'pending' || message.syncStatus === 'streaming') {
        pendingCount += 1;
      }
    }
  }

  return Math.max(pendingCount, pendingQueueLength);
}

function deriveActiveAgent(): AgentActivitySummary | null {
  const chatState = useChatStore.getState();
  if (!chatState.isStreaming) {
    return null;
  }

  const activity = useAgentActivityStore.getState().activeAgent;
  if (activity) {
    return {
      ...activity,
      currentTask: compactText(activity.currentTask, MAX_TASK_LENGTH),
      isStreaming: true,
    };
  }

  const fallbackAgentId = chatState.activeAgentId?.trim();
  if (!fallbackAgentId) {
    return null;
  }

  const runtime = useAgentsRuntimeStore.getState().byId[fallbackAgentId];
  return {
    agentId: fallbackAgentId,
    agentName: runtime?.name ?? fallbackAgentId,
    currentTask: 'Streaming response...',
    model: runtime?.model,
    isStreaming: true,
  };
}

function deriveErrorCount(): number {
  let count = 0;
  for (const agent of Object.values(useAgentsRuntimeStore.getState().byId)) {
    if (agent.status === 'error') {
      count += 1;
    }
  }
  return count;
}

function deriveYesterdayCost(): number | null {
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);

  const key = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, '0'),
    String(yesterday.getDate()).padStart(2, '0'),
  ].join('-');

  const candidate = useDashboardStore.getState().costHistory[key]?.cost;
  return Number.isFinite(candidate) ? candidate : null;
}

function deriveTodayCost(): number | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const key = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const candidate = useDashboardStore.getState().costHistory[key]?.cost;
  return Number.isFinite(candidate) ? candidate : null;
}

export function aggregateSystemSnapshot(): SystemSurfaceSnapshot {
  const connectionState = useConnectionStore.getState();
  const chatState = useChatStore.getState();
  const dashboardState = useDashboardStore.getState();
  const language = useAppPreferencesStore.getState().language;
  const connection = mapConnectionState(connectionState.connectionStatus);
  const activeSessions = dashboardState.snapshot.sessions.length;
  const activeChannels = dashboardState.snapshot.channels.length;
  const pendingQueue = chatState.pendingQueue.length;
  const pendingMessages = countPendingMessages(chatState.messagesBySession, pendingQueue);
  const activeAgent = deriveActiveAgent();
  const cards = dashboardState.snapshot.cards;
  const costTodayCandidate = deriveTodayCost() ?? cards.estimatedCostToday;
  const costToday = Number.isFinite(costTodayCandidate) ? costTodayCandidate : null;
  const costYesterday = deriveYesterdayCost();
  const requestsToday = Number.isFinite(cards.requestsToday) ? cards.requestsToday : null;
  const tokenUsageToday = Number.isFinite(cards.tokenUsageToday) ? cards.tokenUsageToday : null;
  const errorCount = deriveErrorCount();

  return {
    schemaVersion: SYSTEM_SURFACE_SCHEMA_VERSION,
    title: 'ClawLink',
    subtitle: deriveSubtitle({
      language,
      connection,
      activeSessions,
      pendingQueue,
      activeAgent,
    }),
    icon: deriveIcon(connection),
    connection,
    activeSessions,
    activeChannels,
    pendingQueue,
    pendingMessages,
    timestamp: Date.now(),
    disconnectedSince: connectionState.disconnectedSince,
    activeAgent,
    costToday,
    costYesterday,
    requestsToday,
    tokenUsageToday,
    errorCount,
  };
}

export function subscribeSnapshotChanges(
  callback: (snapshot: SystemSurfaceSnapshot) => void,
): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastSnapshotHash = '';

  const schedule = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      const snapshot = aggregateSystemSnapshot();
      const hash = JSON.stringify({
        ...snapshot,
        timestamp: 0,
      });
      if (hash === lastSnapshotHash) {
        return;
      }
      lastSnapshotHash = hash;
      callback(snapshot);
    }, SNAPSHOT_DEBOUNCE_MS);
  };

  const unsubscribers = [
    useConnectionStore.subscribe(schedule),
    useChatStore.subscribe(schedule),
    useDashboardStore.subscribe(schedule),
    useAgentActivityStore.subscribe(schedule),
    useAgentsRuntimeStore.subscribe(schedule),
    useAppPreferencesStore.subscribe(schedule),
  ];

  schedule();

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
