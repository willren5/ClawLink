import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';
import { mmkvZustandStorage } from '../../../lib/mmkv/zustandStorage';

export type AuditActionType =
  | 'restart_agent'
  | 'kill_agent'
  | 'restart_gateway'
  | 'purge_sessions'
  | 'install_skill'
  | 'uninstall_skill';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: AuditActionType;
  target: string;
  result: 'success' | 'failure' | 'cancelled';
  detail?: string;
}

interface AuditLogStoreState {
  entries: AuditLogEntry[];
  appendEntry: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: number }) => void;
  clearEntries: () => void;
}

const MAX_AUDIT_ENTRIES = 300;

function randomId(): string {
  return `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useAuditLogStore = create<AuditLogStoreState>()(
  persist(
    (set) => ({
      entries: [],
      appendEntry: (entry) => {
        const payload: AuditLogEntry = {
          id: randomId(),
          timestamp: entry.timestamp ?? Date.now(),
          action: entry.action,
          target: entry.target,
          result: entry.result,
          detail: entry.detail,
        };

        set((state) => ({
          entries: appendWithLimit(state.entries, payload, MAX_AUDIT_ENTRIES),
        }));
      },
      clearEntries: () => {
        set({ entries: [] });
      },
    }),
    {
      name: STORAGE_KEYS.AUDIT_LOG_STORE,
      storage: createJSONStorage(() => mmkvZustandStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
