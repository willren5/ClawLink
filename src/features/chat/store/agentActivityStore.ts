import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import type { AgentActivitySummary } from '../../system-surfaces/types';

const MAX_TASK_SUMMARY_LENGTH = 60;

interface AgentActivityStoreState {
  activeAgent: AgentActivitySummary | null;
  updatedAt: number | null;
  setActiveAgent: (agent: AgentActivitySummary) => void;
  updateTask: (task: string) => void;
  clearActiveAgent: () => void;
}

function normalizeTask(task: string): string {
  const compact = task.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }
  if (compact.length <= MAX_TASK_SUMMARY_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_TASK_SUMMARY_LENGTH - 3)}...`;
}

function sanitizeActivity(summary: AgentActivitySummary): AgentActivitySummary | null {
  const agentId = summary.agentId.trim();
  const agentName = summary.agentName.trim();

  if (!agentId || !agentName) {
    return null;
  }

  return {
    agentId,
    agentName,
    currentTask: normalizeTask(summary.currentTask),
    model: summary.model?.trim() || undefined,
    isStreaming: summary.isStreaming,
  };
}

export const useAgentActivityStore = create<AgentActivityStoreState>()(
  persist(
    (set, get) => ({
      activeAgent: null,
      updatedAt: null,
      setActiveAgent: (agent) => {
        const sanitized = sanitizeActivity(agent);
        if (!sanitized) {
          return;
        }

        set({
          activeAgent: sanitized,
          updatedAt: Date.now(),
        });
      },
      updateTask: (task) => {
        const current = get().activeAgent;
        if (!current) {
          return;
        }

        const nextTask = normalizeTask(task);
        if (!nextTask) {
          return;
        }

        if (current.currentTask === nextTask) {
          return;
        }

        set({
          activeAgent: {
            ...current,
            currentTask: nextTask,
            isStreaming: true,
          },
          updatedAt: Date.now(),
        });
      },
      clearActiveAgent: () => {
        set({
          activeAgent: null,
          updatedAt: Date.now(),
        });
      },
    }),
    {
      name: STORAGE_KEYS.AGENT_ACTIVITY_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        activeAgent: state.activeAgent,
        updatedAt: state.updatedAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const activeAgent = state.activeAgent ? sanitizeActivity(state.activeAgent) : null;
        useAgentActivityStore.setState({
          activeAgent,
          updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : null,
        });
      },
    },
  ),
);
