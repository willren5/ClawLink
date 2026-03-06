import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';
import type { AgentsResponse } from '../../../lib/schemas';

export interface AgentRuntimeStateItem {
  id: string;
  name: string;
  status: AgentsResponse['agents'][number]['status'];
  model?: string;
}

interface AgentsRuntimeStoreState {
  byId: Record<string, AgentRuntimeStateItem>;
  updatedAt: number | null;
  hydrateAgents: (agents: AgentsResponse['agents']) => void;
  clear: () => void;
}

function sanitizeAgent(item: AgentRuntimeStateItem): AgentRuntimeStateItem | null {
  const id = item.id.trim();
  const name = item.name.trim();

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    status: item.status,
    model: item.model?.trim() || undefined,
  };
}

export const useAgentsRuntimeStore = create<AgentsRuntimeStoreState>()(
  persist(
    (set) => ({
      byId: {},
      updatedAt: null,
      hydrateAgents: (agents) => {
        const now = Date.now();
        const next: Record<string, AgentRuntimeStateItem> = {};

        for (const agent of agents) {
          const sanitized = sanitizeAgent({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            model: agent.model,
          });

          if (!sanitized) {
            continue;
          }

          next[sanitized.id] = sanitized;
        }

        set({
          byId: next,
          updatedAt: now,
        });
      },
      clear: () => {
        set({
          byId: {},
          updatedAt: null,
        });
      },
    }),
    {
      name: STORAGE_KEYS.AGENTS_RUNTIME_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        byId: state.byId,
        updatedAt: state.updatedAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const next: Record<string, AgentRuntimeStateItem> = {};

        for (const [id, item] of Object.entries(state.byId)) {
          const sanitized = sanitizeAgent({
            id,
            name: item.name,
            status: item.status,
            model: item.model,
          });

          if (!sanitized) {
            continue;
          }

          next[sanitized.id] = sanitized;
        }

        useAgentsRuntimeStore.setState({
          byId: next,
          updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : null,
        });
      },
    },
  ),
);
