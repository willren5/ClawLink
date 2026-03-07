import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';
import { createDebouncedJsonStorage } from '../../../lib/mmkv/debouncedJsonStorage';
import { getSessionLastHash, getSessionMessages } from '../../../lib/api';
import { APP_ERROR_CODES, getAppErrorCode } from '../../../lib/errors/appError';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { createContentHash } from '../services/hash';
import { streamChatCompletion } from '../services/streaming';
import { estimateSessionCost, estimateSessionCostFromUsage, estimateTokenCount } from '../services/tokenCounter';
import {
  prunePersistedSessionMessages,
  readPersistedSessionMessages,
  schedulePersistSessionMessages,
} from './sessionMessagesStorage';
import type {
  ChatAttachment,
  ChatAttachmentPreview,
  ChatMessageUsage,
  LocalChatMessage,
  LocalChatSession,
  PendingOutboundMessage,
  ReasoningEffort,
  ToolTimelineStep,
} from '../types';

const MAX_SESSIONS = 40;
const MAX_MESSAGES_PER_SESSION = 500;
const MAX_PENDING = 100;
const MAX_FAILED_OUTBOUND = 32;
const STREAM_TOKEN_FLUSH_MS = 100;
const CHAT_PERSIST_WRITE_DEBOUNCE_MS = 250;
const SESSION_STATE_KEY_SEPARATOR = '@@';
const LEGACY_PROFILE_ID = '__legacy__';
const REMOTE_MESSAGE_MATCH_WINDOW_MS = 2 * 60 * 1000;

interface ChatProfileState {
  activeAgentId: string | null;
  activeSessionId: string | null;
  sessions: Record<string, LocalChatSession>;
  messagesBySession: Record<string, LocalChatMessage[]>;
  pendingQueue: PendingOutboundMessage[];
  failedOutbound: Record<string, PendingOutboundMessage>;
  isStreaming: boolean;
  isSyncing: boolean;
  lastError: string | null;
}

interface ChatStoreState {
  profileStates: Record<string, ChatProfileState>;
  activeAgentId: string | null;
  activeSessionId: string | null;
  sessions: Record<string, LocalChatSession>;
  messagesBySession: Record<string, LocalChatMessage[]>;
  pendingQueue: PendingOutboundMessage[];
  failedOutbound: Record<string, PendingOutboundMessage>;
  isStreaming: boolean;
  isSyncing: boolean;
  lastError: string | null;
  setActiveAgent: (agentId: string | null) => void;
  setActiveSession: (sessionId: string) => void;
  ensureSessionMessagesLoaded: (sessionId: string) => void;
  clearContext: (sessionId: string) => void;
  createSession: (agentId?: string, title?: string, model?: string, reasoningEffort?: ReasoningEffort) => string;
  mergeGatewaySessions: (
    sessions: Array<{
      id: string;
      title?: string;
      agentId?: string;
      model?: string;
      updatedAt?: number;
      messageCount?: number;
      contextCount?: number;
    }>,
  ) => void;
  sendMessage: (params: {
    agentId?: string;
    sessionId: string;
    content: string;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    attachments?: ChatAttachment[];
    attachmentPreviews?: ChatAttachmentPreview[];
  }) => Promise<void>;
  retryFailedMessage: (messageId: string, sessionId: string) => Promise<void>;
  syncSession: (sessionId: string) => Promise<void>;
  flushPendingQueue: () => Promise<void>;
  recalculateSessionCosts: () => void;
}

type ChatStorePersistedState = Pick<
  ChatStoreState,
  'profileStates'
>;

let flushingQueue = false;

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createIdempotencyKey(): string {
  return `claw-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeProfileId(profileId: string | null | undefined): string {
  const normalized = typeof profileId === 'string' ? profileId.trim() : '';
  return normalized || LEGACY_PROFILE_ID;
}

function getActiveChatProfileId(): string {
  return normalizeProfileId(useConnectionStore.getState().activeProfileId);
}

function buildSessionStateKey(profileId: string, gatewaySessionId: string): string {
  return `${normalizeProfileId(profileId)}${SESSION_STATE_KEY_SEPARATOR}${gatewaySessionId.trim()}`;
}

function extractGatewaySessionId(sessionStateKey: string): string {
  const separatorIndex = sessionStateKey.indexOf(SESSION_STATE_KEY_SEPARATOR);
  if (separatorIndex === -1) {
    return sessionStateKey;
  }
  return sessionStateKey.slice(separatorIndex + SESSION_STATE_KEY_SEPARATOR.length);
}

function createEmptyProfileState(): ChatProfileState {
  return {
    activeAgentId: null,
    activeSessionId: null,
    sessions: {},
    messagesBySession: {},
    pendingQueue: [],
    failedOutbound: {},
    isStreaming: false,
    isSyncing: false,
    lastError: null,
  };
}

function projectProfileState(profileState: ChatProfileState): Omit<ChatStoreState, 'profileStates' | 'setActiveAgent' | 'setActiveSession' | 'ensureSessionMessagesLoaded' | 'clearContext' | 'createSession' | 'mergeGatewaySessions' | 'sendMessage' | 'retryFailedMessage' | 'syncSession' | 'flushPendingQueue' | 'recalculateSessionCosts'> {
  return {
    activeAgentId: profileState.activeAgentId,
    activeSessionId: profileState.activeSessionId,
    sessions: profileState.sessions,
    messagesBySession: profileState.messagesBySession,
    pendingQueue: profileState.pendingQueue,
    failedOutbound: profileState.failedOutbound,
    isStreaming: profileState.isStreaming,
    isSyncing: profileState.isSyncing,
    lastError: profileState.lastError,
  };
}

function getProfileState(state: Pick<ChatStoreState, 'profileStates'>, profileId: string): ChatProfileState {
  return state.profileStates[profileId] ?? createEmptyProfileState();
}

function resolveSessionStateKey(profileId: string, profileState: ChatProfileState, sessionId: string): string {
  if (!sessionId) {
    return buildSessionStateKey(profileId, randomId('session'));
  }

  if (profileState.sessions[sessionId]) {
    return sessionId;
  }

  const gatewaySessionId = extractGatewaySessionId(sessionId);
  const stateKey = buildSessionStateKey(profileId, gatewaySessionId);
  return profileState.sessions[stateKey] ? stateKey : stateKey;
}

function createTimelineStep(
  kind: ToolTimelineStep['kind'],
  label: string,
  startedAt: number,
  details?: string,
): ToolTimelineStep {
  return {
    id: randomId('step'),
    kind,
    label,
    ...(details ? { details } : {}),
    startedAt,
    durationMs: 0,
    status: 'running',
  };
}

function closeRunningTimelineStep(step: ToolTimelineStep, now: number): ToolTimelineStep {
  return {
    ...step,
    durationMs: Math.max(100, now - step.startedAt),
    status: 'completed',
  };
}

function summarizeTimelineDetails(raw: unknown, kind: ToolTimelineStep['kind'], label: string): string | undefined {
  if (kind === 'response') {
    return undefined;
  }

  const normalize = (value: string): string | undefined => {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact || compact.toLowerCase() === label.toLowerCase()) {
      return undefined;
    }
    return compact.slice(0, 220);
  };

  if (typeof raw === 'string') {
    return normalize(raw);
  }

  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const direct =
    (typeof record.details === 'string' && record.details) ||
    (typeof record.summary === 'string' && record.summary) ||
    (typeof record.delta === 'string' && record.delta) ||
    '';
  if (direct) {
    return normalize(direct);
  }

  const data = record.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const dataRecord = data as Record<string, unknown>;
    const nested =
      (typeof dataRecord.summary === 'string' && dataRecord.summary) ||
      (typeof dataRecord.delta === 'string' && dataRecord.delta) ||
      (typeof dataRecord.message === 'string' && dataRecord.message) ||
      '';
    if (nested) {
      return normalize(nested);
    }
  }

  return undefined;
}

function normalizeGatewaySessionId(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : randomId('session');
}

function withLimitedSessions(sessions: Record<string, LocalChatSession>): Record<string, LocalChatSession> {
  const entries = Object.entries(sessions).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  if (entries.length <= MAX_SESSIONS) {
    return sessions;
  }

  const trimmed = entries.slice(0, MAX_SESSIONS);
  return Object.fromEntries(trimmed);
}

function pruneMessagesBySessions(
  messagesBySession: Record<string, LocalChatMessage[]>,
  sessions: Record<string, LocalChatSession>,
): Record<string, LocalChatMessage[]> {
  const validSessionIds = new Set(Object.keys(sessions));
  return Object.fromEntries(
    Object.entries(messagesBySession).filter(([sessionId]) => validSessionIds.has(sessionId)),
  );
}

function withLimitedFailedOutbound(
  failedOutbound: Record<string, PendingOutboundMessage>,
): Record<string, PendingOutboundMessage> {
  const entries = Object.entries(failedOutbound).sort((a, b) => b[1].createdAt - a[1].createdAt);
  if (entries.length <= MAX_FAILED_OUTBOUND) {
    return failedOutbound;
  }

  return Object.fromEntries(entries.slice(0, MAX_FAILED_OUTBOUND));
}

function appendMessage(
  profileState: ChatProfileState,
  sessionId: string,
  message: LocalChatMessage,
): Record<string, LocalChatMessage[]> {
  const sessionMessages = profileState.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
  const nextSessionMessages = appendWithLimit(sessionMessages, message, MAX_MESSAGES_PER_SESSION);
  schedulePersistSessionMessages(sessionId, nextSessionMessages);

  return {
    ...profileState.messagesBySession,
    [sessionId]: nextSessionMessages,
  };
}

function updateMessage(
  profileState: ChatProfileState,
  sessionId: string,
  messageId: string,
  updater: (value: LocalChatMessage) => LocalChatMessage,
): Record<string, LocalChatMessage[]> {
  const current = profileState.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
  const next = current.map((item) => (item.id === messageId ? updater(item) : item));
  schedulePersistSessionMessages(sessionId, next);

  return {
    ...profileState.messagesBySession,
    [sessionId]: next,
  };
}

function getLatestServerHash(session: LocalChatSession | undefined): string | undefined {
  const hash = session?.lastServerHash?.trim();
  return hash ? hash : undefined;
}

function deriveSessionTitle(content: string, attachments?: ChatAttachment[]): string {
  const normalized = content.trim();
  if (normalized.length > 0) {
    return normalized.slice(0, 30);
  }

  const imageCount = attachments?.filter((item) => item.type === 'image').length ?? 0;
  if (imageCount > 0) {
    return `Image Session (${imageCount})`;
  }

  return 'Session';
}

function isImageAttachmentPlaceholder(value: string): boolean {
  return /^\[Image attachment x\d+\]$/.test(value.trim());
}

function hasMeaningfulAssistantContent(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return !/^(?:\.{3}|…|-\s*)$/.test(normalized);
}

function normalizeFailureReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  const normalized = reason.trim();
  if (!normalized) {
    return 'Unknown chat error';
  }

  const errorCode = getAppErrorCode(error);
  if (errorCode === APP_ERROR_CODES.GATEWAY_ENDPOINT_NOT_FOUND) {
    return 'Gateway did not expose a compatible chat endpoint. Check gateway chat API configuration.';
  }

  if (errorCode === APP_ERROR_CODES.AUTH_EXPIRED || errorCode === APP_ERROR_CODES.AUTH_FORBIDDEN) {
    return 'Gateway token does not have permission for this chat action.';
  }

  if (errorCode === APP_ERROR_CODES.HTTP_RATE_LIMITED) {
    return 'Gateway/API rate limit reached. Please wait and retry.';
  }

  if (
    errorCode === APP_ERROR_CODES.GATEWAY_PAIRING_REQUIRED ||
    errorCode === APP_ERROR_CODES.GATEWAY_DEVICE_IDENTITY_REQUIRED
  ) {
    return 'Gateway requires device pairing before chat requests are accepted.';
  }

  if (errorCode === APP_ERROR_CODES.SESSION_NOT_FOUND) {
    return 'Gateway session key was rejected. Create a new session and retry.';
  }

  if (errorCode === APP_ERROR_CODES.REQUEST_INVALID || errorCode === APP_ERROR_CODES.RESPONSE_SCHEMA_INVALID) {
    return 'Gateway rejected chat payload format. Try Gateway Default model and retry.';
  }

  if (errorCode === APP_ERROR_CODES.MODEL_UNSUPPORTED) {
    return 'Selected model was rejected by gateway. Try Gateway Default or a model from /api/models.';
  }

  const lowered = normalized.toLowerCase();

  if (lowered.includes('http 404') || lowered.includes('not found')) {
    return 'Gateway did not expose a compatible chat endpoint. Check gateway chat API configuration.';
  }

  if (lowered.includes('permission') || lowered.includes('http 401') || lowered.includes('http 403')) {
    return 'Gateway token does not have permission for this chat action.';
  }

  if (lowered.includes('rate limit') || lowered.includes('too many requests') || lowered.includes('http 429')) {
    return 'Gateway/API rate limit reached. Please wait and retry.';
  }

  if (lowered.includes('pairing_required') || lowered.includes('device_identity_required')) {
    return 'Gateway requires device pairing before chat requests are accepted.';
  }

  if (lowered.includes('session') && lowered.includes('not found')) {
    return 'Gateway session key was rejected. Create a new session and retry.';
  }

  if (
    lowered.includes('invalid_request') ||
    lowered.includes('invalid chat.send params') ||
    lowered.includes('schema') ||
    lowered.includes('must have required property')
  ) {
    return 'Gateway rejected chat payload format. Try Gateway Default model and retry.';
  }

  if (lowered.includes('unsupported model') || lowered.includes('model')) {
    return 'Selected model was rejected by gateway. Try Gateway Default or a model from /api/models.';
  }

  return normalized;
}

function isModelCompatibilityError(reason: string): boolean {
  const lowered = reason.toLowerCase();
  return (
    lowered.includes('unsupported model') ||
    lowered.includes('model was rejected') ||
    (lowered.includes('model') && lowered.includes('invalid')) ||
    (lowered.includes('model') && lowered.includes('not found')) ||
    (lowered.includes('model') && lowered.includes('not available'))
  );
}

function matchRemoteMessage(existing: LocalChatMessage, incoming: LocalChatMessage): boolean {
  if (existing.serverMessageId && incoming.serverMessageId && existing.serverMessageId === incoming.serverMessageId) {
    return true;
  }

  if (existing.role !== incoming.role) {
    return false;
  }

  if (existing.content !== incoming.content) {
    return false;
  }

  return Math.abs(existing.timestamp - incoming.timestamp) <= REMOTE_MESSAGE_MATCH_WINDOW_MS;
}

function mergeRemoteMessages(
  existing: LocalChatMessage[],
  incoming: LocalChatMessage[],
): LocalChatMessage[] {
  const next = [...existing];

  for (const remoteMessage of incoming) {
    const exactIndex = next.findIndex(
      (item) =>
        item.id === remoteMessage.id ||
        (item.serverMessageId && item.serverMessageId === remoteMessage.serverMessageId),
    );

    if (exactIndex >= 0) {
      next[exactIndex] = {
        ...next[exactIndex],
        ...remoteMessage,
        id: next[exactIndex].id,
      };
      continue;
    }

    const softIndex = next.findIndex((item) => matchRemoteMessage(item, remoteMessage));
    if (softIndex >= 0) {
      next[softIndex] = {
        ...next[softIndex],
        ...remoteMessage,
        id: next[softIndex].id,
      };
      continue;
    }

    next.push(remoteMessage);
  }

  return next
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(Math.max(0, next.length - MAX_MESSAGES_PER_SESSION));
}

function buildProfilePatch(
  state: ChatStoreState,
  profileId: string,
  nextProfileState: ChatProfileState,
): Partial<ChatStoreState> {
  const nextProfileStates = {
    ...state.profileStates,
    [profileId]: nextProfileState,
  };

  if (getActiveChatProfileId() !== profileId) {
    return {
      profileStates: nextProfileStates,
    };
  }

  return {
    profileStates: nextProfileStates,
    ...projectProfileState(nextProfileState),
  };
}

function sanitizeSession(
  sessionId: string,
  session: Partial<LocalChatSession> | undefined,
  profileId: string,
): LocalChatSession {
  const gatewaySessionId = normalizeGatewaySessionId(
    typeof session?.gatewaySessionId === 'string' ? session.gatewaySessionId : extractGatewaySessionId(session?.id || sessionId),
  );
  const stateKey = buildSessionStateKey(profileId, gatewaySessionId);

  return {
    id: stateKey,
    gatewaySessionId,
    profileId,
    agentId: typeof session?.agentId === 'string' && session.agentId.trim() ? session.agentId.trim() : undefined,
    title: typeof session?.title === 'string' && session.title.trim() ? session.title : gatewaySessionId,
    updatedAt: Number.isFinite(session?.updatedAt) ? Number(session?.updatedAt) : Date.now(),
    model: typeof session?.model === 'string' && session.model.trim() ? session.model.trim() : undefined,
    reasoningEffort:
      session?.reasoningEffort === 'minimal' ||
      session?.reasoningEffort === 'low' ||
      session?.reasoningEffort === 'medium' ||
      session?.reasoningEffort === 'high'
        ? session.reasoningEffort
        : undefined,
    totalTokens: Number.isFinite(session?.totalTokens) ? Math.max(0, Math.floor(Number(session?.totalTokens))) : 0,
    estimatedCost: Number.isFinite(session?.estimatedCost) ? Math.max(0, Number(session?.estimatedCost)) : 0,
    contextCount: Number.isFinite(session?.contextCount) ? Math.max(0, Math.floor(Number(session?.contextCount))) : 0,
    contextLimit:
      typeof session?.contextLimit === 'number' && Number.isFinite(session.contextLimit)
        ? Math.max(0, Math.floor(session.contextLimit))
        : undefined,
    lastUsageAt:
      typeof session?.lastUsageAt === 'number' && Number.isFinite(session.lastUsageAt)
        ? session.lastUsageAt
        : undefined,
    lastServerHash:
      typeof session?.lastServerHash === 'string' && session.lastServerHash.trim() ? session.lastServerHash.trim() : undefined,
  };
}

function sanitizeMessage(
  message: Partial<LocalChatMessage> | undefined,
  profileId: string,
  sessionId: string,
  gatewaySessionId: string,
): LocalChatMessage | null {
  if (!message) {
    return null;
  }

  const role =
    message.role === 'system' || message.role === 'user' || message.role === 'assistant' || message.role === 'tool'
      ? message.role
      : null;
  if (!role) {
    return null;
  }

  return {
    id: typeof message.id === 'string' && message.id.trim() ? message.id : randomId('msg'),
    sessionId,
    gatewaySessionId,
    profileId,
    role,
    content: typeof message.content === 'string' ? message.content : '',
    timestamp: Number.isFinite(message.timestamp) ? Number(message.timestamp) : Date.now(),
    hash: typeof message.hash === 'string' ? message.hash : '',
    syncStatus:
      message.syncStatus === 'synced' ||
      message.syncStatus === 'pending' ||
      message.syncStatus === 'failed' ||
      message.syncStatus === 'streaming'
        ? message.syncStatus
        : 'pending',
    serverMessageId:
      typeof message.serverMessageId === 'string' && message.serverMessageId.trim()
        ? message.serverMessageId.trim()
        : undefined,
    agentId: typeof message.agentId === 'string' && message.agentId.trim() ? message.agentId.trim() : undefined,
    attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
    toolTimeline: Array.isArray(message.toolTimeline) ? message.toolTimeline : undefined,
    usage: message.usage,
  };
}

function sanitizePendingMessage(
  pending: Partial<PendingOutboundMessage> | undefined,
  profileId: string,
  sessions: Record<string, LocalChatSession>,
): PendingOutboundMessage | null {
  if (!pending || typeof pending.messageId !== 'string' || !pending.messageId.trim()) {
    return null;
  }

  const rawSessionId =
    typeof pending.gatewaySessionId === 'string' && pending.gatewaySessionId.trim()
      ? pending.gatewaySessionId
      : typeof pending.sessionId === 'string'
        ? extractGatewaySessionId(pending.sessionId)
        : '';
  const gatewaySessionId = normalizeGatewaySessionId(rawSessionId);
  const sessionId = buildSessionStateKey(profileId, gatewaySessionId);
  const session = sessions[sessionId];

  return {
    messageId: pending.messageId,
    sessionId,
    gatewaySessionId: session?.gatewaySessionId ?? gatewaySessionId,
    profileId,
    agentId:
      typeof pending.agentId === 'string' && pending.agentId.trim()
        ? pending.agentId.trim()
        : session?.agentId,
    content: typeof pending.content === 'string' ? pending.content : '',
    model: typeof pending.model === 'string' && pending.model.trim() ? pending.model.trim() : undefined,
    reasoningEffort:
      pending.reasoningEffort === 'minimal' ||
      pending.reasoningEffort === 'low' ||
      pending.reasoningEffort === 'medium' ||
      pending.reasoningEffort === 'high'
        ? pending.reasoningEffort
        : undefined,
    createdAt: Number.isFinite(pending.createdAt) ? Number(pending.createdAt) : Date.now(),
    idempotencyKey:
      typeof pending.idempotencyKey === 'string' && pending.idempotencyKey.trim()
        ? pending.idempotencyKey.trim()
        : createIdempotencyKey(),
    attachments: Array.isArray(pending.attachments) ? pending.attachments : undefined,
  };
}

function sanitizeProfileState(
  profileId: string,
  input:
    | (Partial<Omit<ChatProfileState, 'sessions' | 'messagesBySession' | 'pendingQueue' | 'failedOutbound'>> & {
        sessions?: Record<string, Partial<LocalChatSession>>;
        messagesBySession?: Record<string, LocalChatMessage[]>;
        pendingQueue?: Array<Partial<PendingOutboundMessage>>;
        failedOutbound?: Record<string, Partial<PendingOutboundMessage>>;
      })
    | undefined,
): ChatProfileState {
  const normalizedProfileId = normalizeProfileId(profileId);
  const sessions: Record<string, LocalChatSession> = {};

  for (const [sessionId, session] of Object.entries(input?.sessions ?? {})) {
    const sanitized = sanitizeSession(sessionId, session, normalizedProfileId);
    sessions[sanitized.id] = sanitized;
  }

  const messagesBySession: Record<string, LocalChatMessage[]> = {};
  for (const [sessionId, messages] of Object.entries(input?.messagesBySession ?? {})) {
    const resolvedSession = sessions[sessionId] ?? sanitizeSession(sessionId, undefined, normalizedProfileId);
    const sanitizedMessages = Array.isArray(messages)
      ? messages
          .map((message) => sanitizeMessage(message, normalizedProfileId, resolvedSession.id, resolvedSession.gatewaySessionId))
          .filter((message): message is LocalChatMessage => message !== null)
      : [];
    messagesBySession[resolvedSession.id] = sanitizedMessages;
  }

  const pendingQueue = Array.isArray(input?.pendingQueue)
    ? input.pendingQueue
        .map((pending) => sanitizePendingMessage(pending, normalizedProfileId, sessions))
        .filter((pending): pending is PendingOutboundMessage => pending !== null)
    : [];
  const failedOutbound = Object.fromEntries(
    Object.entries(input?.failedOutbound ?? {})
      .map(([messageId, pending]) => [messageId, sanitizePendingMessage(pending, normalizedProfileId, sessions)] as const)
      .filter((entry): entry is [string, PendingOutboundMessage] => entry[1] !== null),
  );

  const activeSessionId =
    typeof input?.activeSessionId === 'string' && input.activeSessionId
      ? resolveSessionStateKey(normalizedProfileId, { ...createEmptyProfileState(), sessions }, input.activeSessionId)
      : null;

  return {
    activeAgentId: typeof input?.activeAgentId === 'string' && input.activeAgentId.trim() ? input.activeAgentId.trim() : null,
    activeSessionId,
    sessions: withLimitedSessions(sessions),
    messagesBySession: pruneMessagesBySessions(messagesBySession, sessions),
    pendingQueue: pendingQueue.slice(0, MAX_PENDING),
    failedOutbound: withLimitedFailedOutbound(failedOutbound),
    isStreaming: input?.isStreaming === true,
    isSyncing: input?.isSyncing === true,
    lastError: typeof input?.lastError === 'string' && input.lastError.trim() ? input.lastError.trim() : null,
  };
}

const chatPersistStorage = createDebouncedJsonStorage<ChatStorePersistedState>(CHAT_PERSIST_WRITE_DEBOUNCE_MS);

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      profileStates: {},
      ...projectProfileState(createEmptyProfileState()),

      setActiveAgent: (agentId) => {
        const profileId = getActiveChatProfileId();
        set((state) =>
          buildProfilePatch(state, profileId, {
            ...getProfileState(state, profileId),
            activeAgentId: agentId?.trim() || null,
          }),
        );
      },

      setActiveSession: (sessionId) => {
        const profileId = getActiveChatProfileId();
        set((state) => {
          const profileState = getProfileState(state, profileId);
          const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
          const persisted = profileState.messagesBySession[resolvedSessionId] ?? readPersistedSessionMessages(resolvedSessionId);

          return buildProfilePatch(state, profileId, {
            ...profileState,
            activeSessionId: resolvedSessionId,
            messagesBySession: {
              ...profileState.messagesBySession,
              [resolvedSessionId]: persisted,
            },
          });
        });
      },

      ensureSessionMessagesLoaded: (sessionId) => {
        const profileId = getActiveChatProfileId();
        set((state) => {
          const profileState = getProfileState(state, profileId);
          const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
          if (!resolvedSessionId || profileState.messagesBySession[resolvedSessionId]) {
            return {};
          }

          return buildProfilePatch(state, profileId, {
            ...profileState,
            messagesBySession: {
              ...profileState.messagesBySession,
              [resolvedSessionId]: readPersistedSessionMessages(resolvedSessionId),
            },
          });
        });
      },

      clearContext: (sessionId) => {
        const profileId = getActiveChatProfileId();
        set((state) => {
          const profileState = getProfileState(state, profileId);
          const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
          schedulePersistSessionMessages(resolvedSessionId, []);

          return buildProfilePatch(state, profileId, {
            ...profileState,
            messagesBySession: {
              ...profileState.messagesBySession,
              [resolvedSessionId]: [],
            },
          });
        });
      },

      createSession: (agentId, title, model, reasoningEffort) => {
        const profileId = getActiveChatProfileId();
        const normalizedAgentId = agentId?.trim();
        const gatewaySessionId = normalizedAgentId ? `agent:${normalizedAgentId}:main` : randomId('session');
        const sessionId = buildSessionStateKey(profileId, gatewaySessionId);
        const now = Date.now();

        set((state) => {
          const profileState = getProfileState(state, profileId);
          const existing = profileState.sessions[sessionId];
          const nextSessions = withLimitedSessions({
            ...profileState.sessions,
            [sessionId]: {
              ...(existing ?? {}),
              id: sessionId,
              gatewaySessionId,
              profileId,
              agentId: normalizedAgentId ?? existing?.agentId,
              title: title ?? existing?.title ?? 'New Session',
              updatedAt: now,
              model: model ?? existing?.model,
              reasoningEffort: reasoningEffort ?? existing?.reasoningEffort,
              totalTokens: existing?.totalTokens ?? 0,
              estimatedCost: existing?.estimatedCost ?? 0,
              contextCount: existing?.contextCount ?? 0,
              contextLimit: existing?.contextLimit,
              lastUsageAt: existing?.lastUsageAt,
              lastServerHash: existing?.lastServerHash,
            },
          });
          const validSessionIds = new Set(Object.keys(nextSessions));
          const nextMessagesBySession = {
            ...pruneMessagesBySessions(profileState.messagesBySession, nextSessions),
            [sessionId]: profileState.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId),
          };

          prunePersistedSessionMessages(validSessionIds);
          schedulePersistSessionMessages(sessionId, nextMessagesBySession[sessionId] ?? []);

          return buildProfilePatch(state, profileId, {
            ...profileState,
            activeAgentId: normalizedAgentId ?? null,
            activeSessionId: sessionId,
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
          });
        });

        return sessionId;
      },

      mergeGatewaySessions: (gatewaySessions) => {
        const activeProfileId = useConnectionStore.getState().activeProfileId;
        if (!activeProfileId || !gatewaySessions.length) {
          return;
        }

        const profileId = normalizeProfileId(activeProfileId);
        set((state) => {
          const profileState = getProfileState(state, profileId);
          const now = Date.now();
          const mergedSessions: Record<string, LocalChatSession> = { ...profileState.sessions };
          let latestGatewaySessionId: string | null = null;
          let latestGatewayUpdatedAt = -1;

          for (const item of gatewaySessions) {
            const gatewaySessionId = normalizeGatewaySessionId(item.id);
            const sessionId = buildSessionStateKey(profileId, gatewaySessionId);
            const existing = mergedSessions[sessionId];
            const updatedAt = item.updatedAt && Number.isFinite(item.updatedAt) ? item.updatedAt : now;
            mergedSessions[sessionId] = {
              ...(existing ?? {}),
              id: sessionId,
              gatewaySessionId,
              profileId,
              title: item.title?.trim() || existing?.title || gatewaySessionId,
              agentId: item.agentId?.trim() || existing?.agentId,
              updatedAt: Math.max(updatedAt, existing?.updatedAt ?? 0),
              model: item.model?.trim() || existing?.model,
              reasoningEffort: existing?.reasoningEffort,
              totalTokens: existing?.totalTokens ?? 0,
              estimatedCost: existing?.estimatedCost ?? 0,
              contextCount: Number.isFinite(item.contextCount)
                ? Math.max(0, Math.floor(item.contextCount ?? 0))
                : existing?.contextCount ?? 0,
              contextLimit: existing?.contextLimit,
              lastUsageAt: existing?.lastUsageAt,
              lastServerHash: existing?.lastServerHash,
            };

            if (updatedAt > latestGatewayUpdatedAt) {
              latestGatewayUpdatedAt = updatedAt;
              latestGatewaySessionId = sessionId;
            }
          }

          const nextSessions = withLimitedSessions(mergedSessions);
          const validSessionIds = new Set(Object.keys(nextSessions));
          const nextMessagesBySession = pruneMessagesBySessions(profileState.messagesBySession, nextSessions);
          prunePersistedSessionMessages(validSessionIds);

          const activeSessionStillValid = profileState.activeSessionId ? Boolean(nextSessions[profileState.activeSessionId]) : false;
          const fallbackSessionId =
            latestGatewaySessionId && nextSessions[latestGatewaySessionId] ? latestGatewaySessionId : null;

          return buildProfilePatch(state, profileId, {
            ...profileState,
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
            activeSessionId: activeSessionStillValid ? profileState.activeSessionId : fallbackSessionId,
          });
        });
      },

      sendMessage: async ({ agentId, sessionId, content, model, reasoningEffort, attachments, attachmentPreviews }) => {
        const activeProfileId = useConnectionStore.getState().activeProfileId;
        if (!activeProfileId) {
          throw new Error('No active gateway profile');
        }

        const profileId = normalizeProfileId(activeProfileId);
        const state = get();
        const profileState = getProfileState(state, profileId);
        const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
        const gatewaySessionId =
          profileState.sessions[resolvedSessionId]?.gatewaySessionId ?? extractGatewaySessionId(resolvedSessionId);
        const hasText = content.trim().length > 0;
        const hasAttachments = (attachments?.length ?? 0) > 0;

        if (!hasText && !hasAttachments) {
          return;
        }

        const now = Date.now();
        const userMessageId = randomId('msg_user');
        const payloadContent = hasText ? content : '';
        const sessionTitle = deriveSessionTitle(content, attachments);
        const resolvedAgentId = agentId ?? profileState.sessions[resolvedSessionId]?.agentId;
        const userHash = await createContentHash(
          `${gatewaySessionId}:user:${payloadContent}:${now}:${hasAttachments ? attachments?.length : 0}`,
        );
        const idempotencyKey = createIdempotencyKey();
        const queueItem: PendingOutboundMessage = {
          messageId: userMessageId,
          sessionId: resolvedSessionId,
          gatewaySessionId,
          profileId,
          agentId: resolvedAgentId,
          content: payloadContent,
          model,
          reasoningEffort,
          createdAt: now,
          idempotencyKey,
          attachments,
        };

        const displayContent = hasText ? content : `[Image attachment x${attachments?.length ?? 0}]`;

        set((currentState) => {
          const currentProfileState = getProfileState(currentState, profileId);
          const queueFull = currentProfileState.pendingQueue.length >= MAX_PENDING;
          const syncStatus: LocalChatMessage['syncStatus'] = queueFull ? 'failed' : 'pending';
          const userMessage: LocalChatMessage = {
            id: userMessageId,
            sessionId: resolvedSessionId,
            gatewaySessionId,
            profileId,
            role: 'user',
            content: displayContent,
            timestamp: now,
            hash: userHash,
            syncStatus,
            agentId: resolvedAgentId,
            attachments: attachmentPreviews,
          };
          const existingSession = currentProfileState.sessions[resolvedSessionId];
          const nextSessions = withLimitedSessions({
            ...currentProfileState.sessions,
            [resolvedSessionId]: {
              ...(existingSession ?? {
                id: resolvedSessionId,
                gatewaySessionId,
                profileId,
                totalTokens: 0,
                estimatedCost: 0,
                contextCount: 0,
              }),
              title: existingSession?.title ?? sessionTitle,
              agentId: resolvedAgentId,
              updatedAt: now,
              model: model ?? existingSession?.model,
              reasoningEffort: reasoningEffort ?? existingSession?.reasoningEffort,
              contextLimit: existingSession?.contextLimit,
              lastUsageAt: existingSession?.lastUsageAt,
              lastServerHash: existingSession?.lastServerHash,
            },
          });
          const nextMessagesBySession = pruneMessagesBySessions(
            appendMessage(currentProfileState, resolvedSessionId, userMessage),
            nextSessions,
          );
          const nextFailedOutbound = queueFull
            ? withLimitedFailedOutbound({
                ...currentProfileState.failedOutbound,
                [userMessageId]: queueItem,
              })
            : currentProfileState.failedOutbound;
          const nextPendingQueue = queueFull ? currentProfileState.pendingQueue : [...currentProfileState.pendingQueue, queueItem];
          const validSessionIds = new Set(Object.keys(nextSessions));
          prunePersistedSessionMessages(validSessionIds);

          return buildProfilePatch(currentState, profileId, {
            ...currentProfileState,
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
            pendingQueue: nextPendingQueue,
            failedOutbound: nextFailedOutbound,
            lastError: queueFull ? 'Pending queue is full. Retry failed items after the backlog is cleared.' : null,
          });
        });

        if (getProfileState(get(), profileId).pendingQueue.some((item) => item.messageId === userMessageId)) {
          await get().flushPendingQueue();
        }
      },

      retryFailedMessage: async (messageId, sessionId) => {
        const activeProfileId = useConnectionStore.getState().activeProfileId;
        if (!activeProfileId) {
          return;
        }

        const profileId = normalizeProfileId(activeProfileId);
        const state = get();
        const profileState = getProfileState(state, profileId);
        const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
        const sourceMessages = profileState.messagesBySession[resolvedSessionId] ?? readPersistedSessionMessages(resolvedSessionId);
        const message = sourceMessages.find((item) => item.id === messageId);
        if (!message || message.role !== 'user') {
          return;
        }

        const failedPayload = profileState.failedOutbound[messageId];
        const retryContent = failedPayload?.content ?? (isImageAttachmentPlaceholder(message.content) ? '' : message.content);
        const queueItem: PendingOutboundMessage = {
          messageId: message.id,
          sessionId: resolvedSessionId,
          gatewaySessionId: failedPayload?.gatewaySessionId ?? message.gatewaySessionId,
          profileId,
          agentId: message.agentId,
          content: retryContent,
          attachments: failedPayload?.attachments,
          model: failedPayload?.model,
          reasoningEffort: failedPayload?.reasoningEffort,
          createdAt: Date.now(),
          idempotencyKey: failedPayload?.idempotencyKey ?? createIdempotencyKey(),
        };

        set((currentState) => {
          const currentProfileState = getProfileState(currentState, profileId);
          if (currentProfileState.pendingQueue.length >= MAX_PENDING) {
            return buildProfilePatch(currentState, profileId, {
              ...currentProfileState,
              lastError: 'Pending queue is full. Clear the backlog before retrying.',
            });
          }

          const nextFailedOutbound = { ...currentProfileState.failedOutbound };
          delete nextFailedOutbound[messageId];

          return buildProfilePatch(currentState, profileId, {
            ...currentProfileState,
            messagesBySession: updateMessage(currentProfileState, resolvedSessionId, messageId, (item) => ({
              ...item,
              syncStatus: 'pending',
            })),
            failedOutbound: nextFailedOutbound,
            pendingQueue: [...currentProfileState.pendingQueue, queueItem],
            lastError: null,
          });
        });

        await get().flushPendingQueue();
      },

      syncSession: async (sessionId) => {
        const activeProfileId = useConnectionStore.getState().activeProfileId;
        if (!activeProfileId) {
          return;
        }

        const profileId = normalizeProfileId(activeProfileId);
        const profileState = getProfileState(get(), profileId);
        const resolvedSessionId = resolveSessionStateKey(profileId, profileState, sessionId);
        const existingSession = profileState.sessions[resolvedSessionId];
        const gatewaySessionId = existingSession?.gatewaySessionId ?? extractGatewaySessionId(resolvedSessionId);
        const localMessages = profileState.messagesBySession[resolvedSessionId] ?? readPersistedSessionMessages(resolvedSessionId);

        if (!profileState.messagesBySession[resolvedSessionId]) {
          set((state) =>
            buildProfilePatch(state, profileId, {
              ...getProfileState(state, profileId),
              messagesBySession: {
                ...getProfileState(state, profileId).messagesBySession,
                [resolvedSessionId]: localMessages,
              },
            }),
          );
        }

        const localHash = getLatestServerHash(existingSession);

        try {
          set((state) =>
            buildProfilePatch(state, profileId, {
              ...getProfileState(state, profileId),
              isSyncing: true,
            }),
          );

          const remote = await getSessionLastHash(gatewaySessionId);
          if (remote.hash && remote.hash === localHash) {
            set((state) => {
              const currentProfileState = getProfileState(state, profileId);
              const session = currentProfileState.sessions[resolvedSessionId];
              if (!session) {
                return {};
              }

              return buildProfilePatch(state, profileId, {
                ...currentProfileState,
                sessions: {
                  ...currentProfileState.sessions,
                  [resolvedSessionId]: {
                    ...session,
                    lastServerHash: remote.hash,
                  },
                },
              });
            });
            return;
          }

          let missing = await getSessionMessages(gatewaySessionId, localHash);
          if (!missing.messages.length && localHash && remote.hash !== localHash) {
            missing = await getSessionMessages(gatewaySessionId);
          }

          const mapped: LocalChatMessage[] = await Promise.all(
            missing.messages.map(async (item) => ({
              id: item.id,
              serverMessageId: item.id,
              sessionId: resolvedSessionId,
              gatewaySessionId,
              profileId,
              role: item.role,
              content: item.content,
              timestamp: Date.parse(item.createdAt) || Date.now(),
              hash: await createContentHash(`${item.sessionId}:${item.role}:${item.content}:${item.createdAt}`),
              syncStatus: 'synced',
              agentId: getProfileState(get(), profileId).sessions[resolvedSessionId]?.agentId ?? getProfileState(get(), profileId).activeAgentId ?? undefined,
            })),
          );

          set((state) => {
            const currentProfileState = getProfileState(state, profileId);
            const currentSession = currentProfileState.sessions[resolvedSessionId] ?? {
              id: resolvedSessionId,
              gatewaySessionId,
              profileId,
              title: gatewaySessionId,
              updatedAt: Date.now(),
              totalTokens: 0,
              estimatedCost: 0,
              contextCount: 0,
            };
            const mergedMessages = mergeRemoteMessages(
              currentProfileState.messagesBySession[resolvedSessionId] ?? localMessages,
              mapped,
            );
            schedulePersistSessionMessages(resolvedSessionId, mergedMessages);

            return buildProfilePatch(state, profileId, {
              ...currentProfileState,
              sessions: {
                ...currentProfileState.sessions,
                [resolvedSessionId]: {
                  ...currentSession,
                  lastServerHash: remote.hash,
                },
              },
              messagesBySession: {
                ...currentProfileState.messagesBySession,
                [resolvedSessionId]: mergedMessages,
              },
            });
          });
        } catch {
          return;
        } finally {
          set((state) =>
            buildProfilePatch(state, profileId, {
              ...getProfileState(state, profileId),
              isSyncing: false,
            }),
          );
        }
      },

      flushPendingQueue: async () => {
        const activeProfileId = useConnectionStore.getState().activeProfileId;
        if (flushingQueue || !activeProfileId) {
          return;
        }

        const profileId = normalizeProfileId(activeProfileId);
        const setStreaming = (isStreaming: boolean): void => {
          set((state) =>
            buildProfilePatch(state, profileId, {
              ...getProfileState(state, profileId),
              isStreaming,
            }),
          );
        };

        flushingQueue = true;
        setStreaming(true);

        try {
          while (getActiveChatProfileId() === profileId) {
            const profileState = getProfileState(get(), profileId);
            const current = profileState.pendingQueue[0];
            if (!current) {
              break;
            }

            const assistantMessageId = randomId('msg_assistant');
            let timelineSteps: ToolTimelineStep[] = [createTimelineStep('reasoning', 'reasoning...', Date.now())];
            let responseTimelineStarted = false;
            let latestUsage: ChatMessageUsage | null = null;

            set((state) => {
              const currentProfileState = getProfileState(state, profileId);
              return buildProfilePatch(state, profileId, {
                ...currentProfileState,
                messagesBySession: appendMessage(currentProfileState, current.sessionId, {
                  id: assistantMessageId,
                  sessionId: current.sessionId,
                  gatewaySessionId: current.gatewaySessionId,
                  profileId,
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  hash: '',
                  syncStatus: 'streaming',
                  agentId: current.agentId,
                  toolTimeline: timelineSteps,
                }),
              });
            });

            const abort = new AbortController();
            let bufferedChunk = '';
            let flushTimer: ReturnType<typeof setTimeout> | null = null;

            const syncAssistantMetadata = (): void => {
              set((state) => {
                const currentProfileState = getProfileState(state, profileId);
                return buildProfilePatch(state, profileId, {
                  ...currentProfileState,
                  messagesBySession: updateMessage(currentProfileState, current.sessionId, assistantMessageId, (item) => ({
                    ...item,
                    toolTimeline: timelineSteps,
                    usage: latestUsage ?? item.usage,
                  })),
                });
              });
            };

            const appendTimelineStep = (
              kind: ToolTimelineStep['kind'],
              label: string,
              raw?: unknown,
              startedAt = Date.now(),
            ): void => {
              const normalizedLabel = label.replace(/\s+/g, ' ').trim();
              if (!normalizedLabel) {
                return;
              }
              const details = summarizeTimelineDetails(raw, kind, normalizedLabel);

              const previous = timelineSteps[timelineSteps.length - 1];
              if (previous && previous.kind === kind && previous.label === normalizedLabel && previous.status === 'running') {
                return;
              }

              timelineSteps = timelineSteps.map((item, index) =>
                index === timelineSteps.length - 1 && item.status === 'running'
                  ? closeRunningTimelineStep(item, startedAt)
                  : item,
              );
              timelineSteps = [...timelineSteps, createTimelineStep(kind, normalizedLabel, startedAt, details)];
              syncAssistantMetadata();
            };

            const finalizeTimeline = (endedAt = Date.now()): void => {
              timelineSteps = timelineSteps.map((item, index) =>
                index === timelineSteps.length - 1 && item.status === 'running'
                  ? closeRunningTimelineStep(item, endedAt)
                  : item,
              );
              syncAssistantMetadata();
            };

            const flushBufferedChunk = (): void => {
              if (!bufferedChunk) {
                return;
              }

              const chunk = bufferedChunk;
              bufferedChunk = '';
              set((state) => {
                const currentProfileState = getProfileState(state, profileId);
                return buildProfilePatch(state, profileId, {
                  ...currentProfileState,
                  messagesBySession: updateMessage(currentProfileState, current.sessionId, assistantMessageId, (item) => ({
                    ...item,
                    content: item.content + chunk,
                  })),
                });
              });
            };

            try {
              const sendWithCurrentOptions = (overrideModel?: string): Promise<string> =>
                streamChatCompletion({
                  sessionId: current.gatewaySessionId,
                  agentId: current.agentId,
                  message: current.content,
                  model: overrideModel,
                  reasoningEffort: current.reasoningEffort,
                  attachments: current.attachments,
                  idempotencyKey: current.idempotencyKey,
                  signal: abort.signal,
                  onToken: (chunk) => {
                    if (!responseTimelineStarted) {
                      appendTimelineStep('response', 'response generated');
                      responseTimelineStarted = true;
                    }
                    bufferedChunk += chunk;
                    if (flushTimer) {
                      return;
                    }

                    flushTimer = setTimeout(() => {
                      flushTimer = null;
                      flushBufferedChunk();
                    }, STREAM_TOKEN_FLUSH_MS);
                  },
                  onToolEvent: (event) => {
                    appendTimelineStep(event.kind, event.label, event.raw);
                  },
                  onUsage: (usage) => {
                    latestUsage = usage;
                    syncAssistantMetadata();
                  },
                });

              let content: string;
              let usedGatewayDefaultModel = false;
              try {
                content = await sendWithCurrentOptions(current.model);
              } catch (primaryError: unknown) {
                const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
                if (!current.model || !isModelCompatibilityError(message)) {
                  throw primaryError;
                }
                usedGatewayDefaultModel = true;
                content = await sendWithCurrentOptions(undefined);
              }

              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              flushBufferedChunk();

              const now = Date.now();
              finalizeTimeline(now);
              const assistantHash = await createContentHash(`${current.gatewaySessionId}:assistant:${content}:${now}`);
              const estimatedTokens = estimateTokenCount(current.content) + estimateTokenCount(content);
              const usageTotalTokens = Number((latestUsage as ChatMessageUsage | null)?.totalTokens ?? 0);
              const tokenIncrement = usageTotalTokens > 0 ? usageTotalTokens : estimatedTokens;
              const lastServerHash = await getSessionLastHash(current.gatewaySessionId)
                .then((response) => response.hash)
                .catch(() => undefined);

              set((state) => {
                const currentProfileState = getProfileState(state, profileId);
                const nextPendingQueue = currentProfileState.pendingQueue.slice(1);
                const nextFailedOutbound = { ...currentProfileState.failedOutbound };
                delete nextFailedOutbound[current.messageId];

                const nextSessionMessages = (currentProfileState.messagesBySession[current.sessionId] ?? []).map(
                  (item): LocalChatMessage => {
                    if (item.id === current.messageId) {
                      return {
                        ...item,
                        syncStatus: 'synced',
                      };
                    }

                    if (item.id === assistantMessageId) {
                      return {
                        ...item,
                        content,
                        timestamp: now,
                        hash: assistantHash,
                        syncStatus: 'synced',
                        toolTimeline: timelineSteps,
                        usage: latestUsage ?? item.usage,
                      };
                    }

                    return item;
                  },
                );
                schedulePersistSessionMessages(current.sessionId, nextSessionMessages);

                const existingSession = currentProfileState.sessions[current.sessionId];
                const nextModel = usedGatewayDefaultModel ? undefined : current.model ?? existingSession?.model;
                const nextTotalTokens = (existingSession?.totalTokens ?? 0) + tokenIncrement;
                const requestCost = latestUsage
                  ? estimateSessionCostFromUsage(latestUsage, nextModel)
                  : estimateSessionCost(tokenIncrement, nextModel);
                const nextContextCount =
                  latestUsage?.contextTokens ??
                  latestUsage?.promptTokens ??
                  Math.max(existingSession?.contextCount ?? 0, nextTotalTokens);
                const nextContextLimit = latestUsage?.contextLimit ?? existingSession?.contextLimit;

                return buildProfilePatch(state, profileId, {
                  ...currentProfileState,
                  messagesBySession: {
                    ...currentProfileState.messagesBySession,
                    [current.sessionId]: nextSessionMessages,
                  },
                  sessions: {
                    ...currentProfileState.sessions,
                    [current.sessionId]: {
                      ...(existingSession ?? {
                        id: current.sessionId,
                        gatewaySessionId: current.gatewaySessionId,
                        profileId,
                        agentId: current.agentId,
                        title: deriveSessionTitle(current.content, current.attachments),
                        totalTokens: 0,
                        estimatedCost: 0,
                        contextCount: 0,
                      }),
                      updatedAt: now,
                      model: nextModel,
                      reasoningEffort: current.reasoningEffort ?? existingSession?.reasoningEffort,
                      totalTokens: nextTotalTokens,
                      estimatedCost: Number(((existingSession?.estimatedCost ?? 0) + requestCost).toFixed(4)),
                      contextCount: Math.max(0, Math.floor(nextContextCount)),
                      contextLimit: nextContextLimit,
                      lastUsageAt: now,
                      lastServerHash: lastServerHash ?? existingSession?.lastServerHash,
                    },
                  },
                  failedOutbound: nextFailedOutbound,
                  pendingQueue: nextPendingQueue,
                  lastError: null,
                });
              });
            } catch (error: unknown) {
              abort.abort();
              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              bufferedChunk = '';
              appendTimelineStep('io', 'response failed');
              finalizeTimeline();
              const failureNote = normalizeFailureReason(error);

              if (getActiveChatProfileId() !== profileId) {
                set((state) => {
                  const currentProfileState = getProfileState(state, profileId);
                  const nextSessionMessages = (currentProfileState.messagesBySession[current.sessionId] ?? []).filter(
                    (item) => item.id !== assistantMessageId,
                  );
                  schedulePersistSessionMessages(current.sessionId, nextSessionMessages);

                  return buildProfilePatch(state, profileId, {
                    ...currentProfileState,
                    messagesBySession: {
                      ...currentProfileState.messagesBySession,
                      [current.sessionId]: nextSessionMessages,
                    },
                    isStreaming: false,
                  });
                });
                break;
              }

              set((state) => {
                const currentProfileState = getProfileState(state, profileId);
                const nextSessionMessages = (currentProfileState.messagesBySession[current.sessionId] ?? []).map(
                  (item): LocalChatMessage => {
                    if (item.id === current.messageId) {
                      return {
                        ...item,
                        syncStatus: 'failed',
                      };
                    }

                    if (item.id === assistantMessageId) {
                      const fallbackContent = `Request failed: ${failureNote}`;
                      return {
                        ...item,
                        content: hasMeaningfulAssistantContent(item.content) ? item.content : fallbackContent,
                        syncStatus: 'failed',
                      };
                    }

                    return item;
                  },
                );
                schedulePersistSessionMessages(current.sessionId, nextSessionMessages);

                return buildProfilePatch(state, profileId, {
                  ...currentProfileState,
                  messagesBySession: {
                    ...currentProfileState.messagesBySession,
                    [current.sessionId]: nextSessionMessages,
                  },
                  failedOutbound: withLimitedFailedOutbound({
                    ...currentProfileState.failedOutbound,
                    [current.messageId]: current,
                  }),
                  pendingQueue: currentProfileState.pendingQueue.slice(1),
                  lastError: failureNote,
                });
              });
            }
          }
        } finally {
          flushingQueue = false;
          setStreaming(false);
        }
      },

      recalculateSessionCosts: () => {
        const activeProfileId = getActiveChatProfileId();
        set((state) => {
          let changed = false;
          const nextProfileStates = Object.fromEntries(
            Object.entries(state.profileStates).map(([profileId, profileState]) => {
              const nextSessions = Object.fromEntries(
                Object.entries(profileState.sessions).map(([sessionId, session]) => {
                  const nextCost = estimateSessionCost(session.totalTokens, session.model);
                  if (nextCost !== session.estimatedCost) {
                    changed = true;
                    return [sessionId, { ...session, estimatedCost: nextCost }];
                  }

                  return [sessionId, session];
                }),
              ) as Record<string, LocalChatSession>;

              const sessionIds = Object.keys(nextSessions);
              const sameSessionCount = sessionIds.length === Object.keys(profileState.sessions).length;
              const sessionsChanged =
                !sameSessionCount || sessionIds.some((sessionId) => nextSessions[sessionId] !== profileState.sessions[sessionId]);

              return [profileId, sessionsChanged ? { ...profileState, sessions: nextSessions } : profileState];
            }),
          ) as Record<string, ChatProfileState>;

          if (!changed) {
            return {};
          }

          const activeProfileState = nextProfileStates[activeProfileId] ?? createEmptyProfileState();
          return {
            profileStates: nextProfileStates,
            ...projectProfileState(activeProfileState),
          };
        });
      },
    }),
    {
      name: STORAGE_KEYS.CHAT_STORE,
      storage: chatPersistStorage,
      partialize: (state): ChatStorePersistedState => ({
        profileStates: state.profileStates,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const legacyState = state as ChatStorePersistedState & {
          activeAgentId?: string | null;
          activeSessionId?: string | null;
          sessions?: Record<string, Partial<LocalChatSession>>;
          pendingQueue?: PendingOutboundMessage[];
          failedOutbound?: Record<string, PendingOutboundMessage>;
          messagesBySession?: Record<string, LocalChatMessage[]>;
        };
        const currentProfileId = getActiveChatProfileId();
        const nextProfileStates = Object.keys(state.profileStates ?? {}).length > 0
          ? Object.fromEntries(
              Object.entries(state.profileStates ?? {}).map(([profileId, profileState]) => [
                normalizeProfileId(profileId),
                sanitizeProfileState(profileId, profileState),
              ]),
            )
          : {
              [currentProfileId]: sanitizeProfileState(currentProfileId, {
                activeAgentId: legacyState.activeAgentId ?? null,
                activeSessionId: legacyState.activeSessionId ?? null,
                sessions: legacyState.sessions ?? {},
                pendingQueue: legacyState.pendingQueue ?? [],
                failedOutbound: legacyState.failedOutbound ?? {},
                messagesBySession: {},
                isStreaming: false,
                isSyncing: false,
                lastError: null,
              }),
            };

        const migratedMessagesBySession = legacyState.messagesBySession ?? {};
        if (Object.keys(migratedMessagesBySession).length > 0) {
          const legacyProfileState = nextProfileStates[currentProfileId];
          const nextMessagesBySession = { ...legacyProfileState.messagesBySession };

          for (const [sessionId, messages] of Object.entries(migratedMessagesBySession)) {
            const sanitizedSession = legacyProfileState.sessions[buildSessionStateKey(currentProfileId, extractGatewaySessionId(sessionId))] ??
              sanitizeSession(sessionId, legacyProfileState.sessions[sessionId], currentProfileId);
            const sanitizedMessages = messages
              .map((message) =>
                sanitizeMessage(message, currentProfileId, sanitizedSession.id, sanitizedSession.gatewaySessionId),
              )
              .filter((message): message is LocalChatMessage => message !== null);
            nextMessagesBySession[sanitizedSession.id] = sanitizedMessages;
            schedulePersistSessionMessages(sanitizedSession.id, sanitizedMessages);
          }

          nextProfileStates[currentProfileId] = {
            ...legacyProfileState,
            sessions: {
              ...legacyProfileState.sessions,
            },
            messagesBySession: nextMessagesBySession,
          };
        }

        const projectedProfileState = nextProfileStates[currentProfileId] ?? createEmptyProfileState();
        const validSessionIds = new Set(
          Object.values(nextProfileStates).flatMap((profileState) => Object.keys(profileState.sessions)),
        );
        prunePersistedSessionMessages(validSessionIds);

        useChatStore.setState({
          profileStates: nextProfileStates,
          ...projectProfileState(projectedProfileState),
        });
      },
    },
  ),
);

function syncChatProjectionToActiveProfile(): void {
  const state = useChatStore.getState();
  const profileId = getActiveChatProfileId();
  const profileState = getProfileState(state, profileId);
  useChatStore.setState({
    ...projectProfileState(profileState),
  });
}

useConnectionStore.subscribe((state, previousState) => {
  if (state.activeProfileId !== previousState.activeProfileId) {
    syncChatProjectionToActiveProfile();
  }
});
