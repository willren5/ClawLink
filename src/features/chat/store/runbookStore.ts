import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

export interface ChatRunbook {
  id: string;
  label: string;
  text: string;
  agentId: string | null;
  system: boolean;
  createdAt: number;
  updatedAt: number;
}

interface RunbookStoreState {
  customRunbooks: ChatRunbook[];
  saveRunbook: (input: { label: string; text: string; agentId?: string | null }) => ChatRunbook;
  removeRunbook: (id: string) => void;
}

function randomRunbookId(): string {
  return `runbook_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLabel(value: string): string {
  const sanitized = sanitizeText(value);
  if (!sanitized) {
    return 'Runbook';
  }

  return sanitized.slice(0, 28);
}

function normalizeAgentId(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function resolveRunbooksForAgent(
  customRunbooks: ChatRunbook[],
  agentId: string | null | undefined,
): ChatRunbook[] {
  const normalizedAgentId = normalizeAgentId(agentId);
  const scoped = customRunbooks
    .filter((item) => item.agentId === normalizedAgentId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const global = customRunbooks
    .filter((item) => item.agentId === null)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return [...scoped, ...global];
}

export const useChatRunbookStore = create<RunbookStoreState>()(
  persist(
    (set) => ({
      customRunbooks: [],
      saveRunbook: (input) => {
        const now = Date.now();
        const entry: ChatRunbook = {
          id: randomRunbookId(),
          label: normalizeLabel(input.label),
          text: sanitizeText(input.text),
          agentId: normalizeAgentId(input.agentId),
          system: false,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          customRunbooks: [entry, ...state.customRunbooks].slice(0, 40),
        }));

        return entry;
      },
      removeRunbook: (id) => {
        const targetId = id.trim();
        if (!targetId) {
          return;
        }

        set((state) => ({
          customRunbooks: state.customRunbooks.filter((item) => item.id !== targetId),
        }));
      },
    }),
    {
      name: 'chat-runbook-store',
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({
        customRunbooks: state.customRunbooks,
      }),
    },
  ),
);
