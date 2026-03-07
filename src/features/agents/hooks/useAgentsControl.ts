import { useCallback, useEffect, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';

import {
  createAgent,
  getAgents,
  getAgentLogs,
  killAgent,
  restartAgent,
  toggleAgent,
} from '../../../lib/api';
import { getAppErrorCode, type AppErrorCode } from '../../../lib/errors/appError';
import type { AgentsResponse } from '../../../lib/schemas';
import { authenticateAction } from '../../../lib/security/biometric';
import { useAuditLogStore } from '../../security/store/auditLogStore';
import { useAgentsRuntimeStore } from '../store/agentsRuntimeStore';
import type { AgentListItem } from '../types';

interface UseAgentsControlResult {
  agents: AgentListItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  selectedAgentId: string | null;
  selectedAgentLogs: string[];
  logsHasMore: boolean;
  logsLoading: boolean;
  setSelectedAgentId: (agentId: string | null) => void;
  refresh: () => Promise<void>;
  createOneAgent: (input: {
    name: string;
    model?: string;
    systemPrompt?: string;
  }) => Promise<{ ok: boolean; message?: string; error?: string; errorCode?: AppErrorCode }>;
  toggleAgentStatus: (agentId: string, enabled: boolean) => Promise<boolean>;
  restartOneAgent: (agentId: string) => Promise<boolean>;
  killOneAgent: (agentId: string) => Promise<boolean>;
  loadAgentLogs: (agentId: string) => Promise<void>;
  loadMoreAgentLogs: () => Promise<void>;
}

const DEFAULT_AGENT_LOGS_LIMIT = 100;

function mapAgents(response: AgentsResponse): AgentListItem[] {
  return response.agents.map((agent: AgentsResponse['agents'][number]) => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    lastActiveAt: agent.lastActiveAt,
    conversationCount: agent.conversationCount,
    model: agent.model,
  }));
}

export function useAgentsControl(): UseAgentsControlResult {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<string[]>([]);
  const [selectedAgentLogsLimit, setSelectedAgentLogsLimit] = useState(DEFAULT_AGENT_LOGS_LIMIT);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const appendAuditEntry = useAuditLogStore((state) => state.appendEntry);

  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      const response = await getAgents();
      if (!mountedRef.current) {
        return;
      }
      useAgentsRuntimeStore.getState().hydrateAgents(response.agents);
      setAgents(mapAgents(response));
    } catch (nextError: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Failed to load agents');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createOneAgent = useCallback(
    async (input: {
      name: string;
      model?: string;
      systemPrompt?: string;
    }): Promise<{ ok: boolean; message?: string; error?: string; errorCode?: AppErrorCode }> => {
      const allowed = await authenticateAction('Create agent?');
      if (!allowed) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return {
          ok: false,
          error: 'Biometric check cancelled',
          errorCode: undefined,
        };
      }

      try {
        const normalized = {
          name: input.name,
          model: input.model?.trim() || undefined,
          systemPrompt: input.systemPrompt?.trim() || undefined,
        };

        const result = await createAgent(normalized);
        await refresh();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return {
          ok: true,
          message: result.message,
        };
      } catch (error: unknown) {
        const firstErrorMessage = error instanceof Error ? error.message : 'Failed to create agent.';
        const firstErrorCode = getAppErrorCode(error);
        const hasOptionalConfig = Boolean(input.model?.trim() || input.systemPrompt?.trim());

        if (hasOptionalConfig) {
          try {
            // Some gateways reject model/prompt at create-time and only allow name/workspace.
            const retryResult = await createAgent({
              name: input.name,
            });
            await refresh();
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            return {
              ok: true,
              message:
                retryResult.message ??
                'Agent created without model/prompt. Configure model or prompt later in gateway settings.',
            };
          } catch {
            // Keep original error for clearer diagnostics.
          }
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return {
          ok: false,
          error: firstErrorMessage,
          errorCode: firstErrorCode,
        };
      }
    },
    [refresh],
  );

  const toggleAgentStatus = useCallback(
    async (agentId: string, enabled: boolean): Promise<boolean> => {
      try {
        await toggleAgent(agentId, enabled);
        await refresh();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      } catch {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }
    },
    [refresh],
  );

  const restartOneAgent = useCallback(
    async (agentId: string): Promise<boolean> => {
      const allowed = await authenticateAction('Restart agent process?');
      if (!allowed) {
        appendAuditEntry({
          action: 'restart_agent',
          target: agentId,
          result: 'cancelled',
          detail: 'Biometric check cancelled',
        });
        return false;
      }

      try {
        await restartAgent(agentId);
        await refresh();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        appendAuditEntry({
          action: 'restart_agent',
          target: agentId,
          result: 'success',
        });
        return true;
      } catch {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        appendAuditEntry({
          action: 'restart_agent',
          target: agentId,
          result: 'failure',
        });
        return false;
      }
    },
    [appendAuditEntry, refresh],
  );

  const killOneAgent = useCallback(
    async (agentId: string): Promise<boolean> => {
      const allowed = await authenticateAction('Kill this agent immediately?');
      if (!allowed) {
        appendAuditEntry({
          action: 'kill_agent',
          target: agentId,
          result: 'cancelled',
          detail: 'Biometric check cancelled',
        });
        return false;
      }

      try {
        await killAgent(agentId);
        await refresh();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        appendAuditEntry({
          action: 'kill_agent',
          target: agentId,
          result: 'success',
        });
        return true;
      } catch {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        appendAuditEntry({
          action: 'kill_agent',
          target: agentId,
          result: 'failure',
        });
        return false;
      }
    },
    [appendAuditEntry, refresh],
  );

  const loadAgentLogs = useCallback(async (agentId: string, limit = DEFAULT_AGENT_LOGS_LIMIT) => {
    setLogsLoading(true);
    try {
      const response = await getAgentLogs(agentId, { limit });
      if (!mountedRef.current) {
        return;
      }

      setSelectedAgentId(agentId);
      setSelectedAgentLogs(response.logs);
      setSelectedAgentLogsLimit(limit);
      setLogsHasMore(response.logs.length >= limit);
    } catch (error: unknown) {
      if (!mountedRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to load logs';
      setSelectedAgentId(agentId);
      setSelectedAgentLogs([`[log-unavailable] ${message}`]);
      setLogsHasMore(false);
    } finally {
      if (mountedRef.current) {
        setLogsLoading(false);
      }
    }
  }, []);

  const loadMoreAgentLogs = useCallback(async () => {
    if (!selectedAgentId || logsLoading || !logsHasMore) {
      return;
    }

    await loadAgentLogs(selectedAgentId, selectedAgentLogsLimit + DEFAULT_AGENT_LOGS_LIMIT);
  }, [loadAgentLogs, logsHasMore, logsLoading, selectedAgentId, selectedAgentLogsLimit]);

  return {
    agents,
    loading,
    refreshing,
    error,
    selectedAgentId,
    selectedAgentLogs,
    logsHasMore,
    logsLoading,
    setSelectedAgentId,
    refresh,
    createOneAgent,
    toggleAgentStatus,
    restartOneAgent,
    killOneAgent,
    loadAgentLogs,
    loadMoreAgentLogs,
  };
}
