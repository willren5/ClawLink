import { appStorage } from '../../../lib/mmkv/storage';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import type { LocalChatMessage } from '../types';

const SESSION_MESSAGES_PREFIX = 'chat:messages:';
const SESSION_INDEX_KEY = 'chat:messages:index';
const SESSION_WRITE_DEBOUNCE_MS = 250;

const pendingWrites = new Map<string, LocalChatMessage[]>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function toSessionKey(sessionId: string): string {
  return `${SESSION_MESSAGES_PREFIX}${sessionId}`;
}

function readSessionIndex(): string[] {
  const raw = appStorage.getString(SESSION_INDEX_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function writeSessionIndex(next: string[]): void {
  appStorage.set(SESSION_INDEX_KEY, JSON.stringify(next));
}

function ensureSessionInIndex(sessionId: string): void {
  const index = readSessionIndex();
  if (index.includes(sessionId)) {
    return;
  }

  writeSessionIndex([...index, sessionId]);
}

function shouldPersistSessionMessages(): boolean {
  return useAppPreferencesStore.getState().persistChatTranscripts !== false;
}

function flushSession(sessionId: string): void {
  const timer = writeTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    writeTimers.delete(sessionId);
  }

  const pending = pendingWrites.get(sessionId);
  if (!pending) {
    return;
  }

  pendingWrites.delete(sessionId);
  appStorage.set(toSessionKey(sessionId), JSON.stringify(pending));
  ensureSessionInIndex(sessionId);
}

export function readPersistedSessionMessages(sessionId: string): LocalChatMessage[] {
  if (!shouldPersistSessionMessages()) {
    return [];
  }

  const pending = pendingWrites.get(sessionId);
  if (pending) {
    return pending;
  }

  const raw = appStorage.getString(toSessionKey(sessionId));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as LocalChatMessage[];
  } catch {
    return [];
  }
}

export function schedulePersistSessionMessages(sessionId: string, messages: LocalChatMessage[]): void {
  if (!shouldPersistSessionMessages()) {
    removePersistedSessionMessages(sessionId);
    return;
  }

  pendingWrites.set(sessionId, messages);

  const existing = writeTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }

  writeTimers.set(
    sessionId,
    setTimeout(() => {
      flushSession(sessionId);
    }, SESSION_WRITE_DEBOUNCE_MS),
  );
}

export function removePersistedSessionMessages(sessionId: string): void {
  const timer = writeTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    writeTimers.delete(sessionId);
  }

  pendingWrites.delete(sessionId);
  appStorage.remove(toSessionKey(sessionId));

  const index = readSessionIndex();
  if (!index.includes(sessionId)) {
    return;
  }

  writeSessionIndex(index.filter((value) => value !== sessionId));
}

export function prunePersistedSessionMessages(validSessionIds: Set<string>): void {
  if (!shouldPersistSessionMessages()) {
    clearAllPersistedSessionMessages();
    return;
  }

  const index = readSessionIndex();
  const nextIndex: string[] = [];

  for (const sessionId of index) {
    if (validSessionIds.has(sessionId)) {
      nextIndex.push(sessionId);
      continue;
    }

    removePersistedSessionMessages(sessionId);
  }

  if (nextIndex.length !== index.length) {
    writeSessionIndex(nextIndex);
  }
}

export function clearAllPersistedSessionMessages(): void {
  const index = readSessionIndex();

  for (const sessionId of index) {
    removePersistedSessionMessages(sessionId);
  }

  if (index.length > 0) {
    writeSessionIndex([]);
  }
}
