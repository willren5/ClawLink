import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../../../constants/storageKeys';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';
import { createDebouncedJsonStorage } from '../../../lib/mmkv/debouncedJsonStorage';
import { getSessionLastHash, getSessionMessages } from '../../../lib/api';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { createContentHash } from '../services/hash';
import { streamChatCompletion } from '../services/streaming';
import { estimateSessionCost, estimateTokenCount } from '../services/tokenCounter';
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

interface ChatStoreState {
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
}

type ChatStorePersistedState = Pick<
  ChatStoreState,
  'activeAgentId' | 'activeSessionId' | 'sessions' | 'pendingQueue' | 'failedOutbound'
>;

let flushingQueue = false;

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createTimelineStep(
  kind: ToolTimelineStep['kind'],
  label: string,
  startedAt: number,
): ToolTimelineStep {
  return {
    id: randomId('step'),
    kind,
    label,
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
  state: ChatStoreState,
  sessionId: string,
  message: LocalChatMessage,
): Record<string, LocalChatMessage[]> {
  const sessionMessages = state.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
  const nextSessionMessages = appendWithLimit(sessionMessages, message, MAX_MESSAGES_PER_SESSION);
  schedulePersistSessionMessages(sessionId, nextSessionMessages);

  return {
    ...state.messagesBySession,
    [sessionId]: nextSessionMessages,
  };
}

function updateMessage(
  state: ChatStoreState,
  sessionId: string,
  messageId: string,
  updater: (value: LocalChatMessage) => LocalChatMessage,
): Record<string, LocalChatMessage[]> {
  const current = state.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
  const next = current.map((item) => (item.id === messageId ? updater(item) : item));
  schedulePersistSessionMessages(sessionId, next);

  return {
    ...state.messagesBySession,
    [sessionId]: next,
  };
}

function getLatestSyncedHash(messages: LocalChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.syncStatus === 'synced' && item.hash.trim().length > 0) {
      return item.hash;
    }
  }

  return undefined;
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

function normalizeFailureReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    return 'Unknown chat error';
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

const chatPersistStorage = createDebouncedJsonStorage<ChatStorePersistedState>(CHAT_PERSIST_WRITE_DEBOUNCE_MS);

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      activeAgentId: null,
      activeSessionId: null,
      sessions: {},
      messagesBySession: {},
      pendingQueue: [],
      failedOutbound: {},
      isStreaming: false,
      isSyncing: false,
      lastError: null,

      setActiveAgent: (agentId) => {
        set({ activeAgentId: agentId });
      },

      setActiveSession: (sessionId) => {
        set({ activeSessionId: sessionId });

        const existing = get().messagesBySession[sessionId];
        if (existing) {
          return;
        }

        const persisted = readPersistedSessionMessages(sessionId);
        set((state) => ({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: persisted,
          },
        }));
      },

      ensureSessionMessagesLoaded: (sessionId) => {
        if (!sessionId || get().messagesBySession[sessionId]) {
          return;
        }

        const persisted = readPersistedSessionMessages(sessionId);
        set((state) => ({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: persisted,
          },
        }));
      },

      clearContext: (sessionId) => {
        set((state) => ({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: [],
          },
        }));

        schedulePersistSessionMessages(sessionId, []);
      },

      createSession: (agentId, title, model, reasoningEffort) => {
        const normalizedAgentId = agentId?.trim();
        const sessionId = normalizedAgentId ? `agent:${normalizedAgentId}:main` : randomId('session');
        const now = Date.now();

        set((state) => {
          const existing = state.sessions[sessionId];
          const nextSessions = withLimitedSessions({
            ...state.sessions,
            [sessionId]: {
              ...(existing ?? {}),
              id: sessionId,
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
            },
          });
          const validSessionIds = new Set(Object.keys(nextSessions));
          const nextMessagesBySession = {
            ...pruneMessagesBySessions(state.messagesBySession, nextSessions),
            [sessionId]: state.messagesBySession[sessionId] ?? [],
          };

          prunePersistedSessionMessages(validSessionIds);
          schedulePersistSessionMessages(sessionId, nextMessagesBySession[sessionId] ?? []);

          return {
            activeAgentId: agentId ?? null,
            activeSessionId: sessionId,
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
          };
        });

        return sessionId;
      },

      mergeGatewaySessions: (gatewaySessions) => {
        if (!gatewaySessions.length) {
          return;
        }

        set((state) => {
          const now = Date.now();
          const mergedSessions: Record<string, LocalChatSession> = { ...state.sessions };
          let latestGatewaySessionId: string | null = null;
          let latestGatewayUpdatedAt = -1;

          for (const item of gatewaySessions) {
            const sessionId = normalizeGatewaySessionId(item.id);
            const existing = mergedSessions[sessionId];
            const updatedAt = item.updatedAt && Number.isFinite(item.updatedAt) ? item.updatedAt : now;
            mergedSessions[sessionId] = {
              ...(existing ?? {}),
              id: sessionId,
              title: item.title?.trim() || existing?.title || sessionId,
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
            };

            if (updatedAt > latestGatewayUpdatedAt) {
              latestGatewayUpdatedAt = updatedAt;
              latestGatewaySessionId = sessionId;
            }
          }

          const nextSessions = withLimitedSessions(mergedSessions);
          const validSessionIds = new Set(Object.keys(nextSessions));
          const nextMessagesBySession = pruneMessagesBySessions(state.messagesBySession, nextSessions);
          prunePersistedSessionMessages(validSessionIds);

          const activeSessionStillValid = state.activeSessionId ? Boolean(nextSessions[state.activeSessionId]) : false;
          const fallbackSessionId = latestGatewaySessionId && nextSessions[latestGatewaySessionId] ? latestGatewaySessionId : null;
          const nextActiveSessionId = activeSessionStillValid
            ? state.activeSessionId
            : fallbackSessionId ?? null;

          return {
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
            activeSessionId: nextActiveSessionId,
          };
        });
      },

      sendMessage: async ({ agentId, sessionId, content, model, reasoningEffort, attachments, attachmentPreviews }) => {
        const hasText = content.trim().length > 0;
        const hasAttachments = (attachments?.length ?? 0) > 0;

        if (!hasText && !hasAttachments) {
          return;
        }

        const now = Date.now();
        const userMessageId = randomId('msg_user');
        const payloadContent = hasText ? content : '';
        const sessionTitle = deriveSessionTitle(content, attachments);
        const resolvedAgentId = agentId ?? get().sessions[sessionId]?.agentId;
        const userHash = await createContentHash(
          `${sessionId}:user:${payloadContent}:${now}:${hasAttachments ? attachments?.length : 0}`,
        );

        const displayContent = hasText ? content : `[Image attachment x${attachments?.length ?? 0}]`;

        const userMessage: LocalChatMessage = {
          id: userMessageId,
          sessionId,
          role: 'user',
          content: displayContent,
          timestamp: now,
          hash: userHash,
          syncStatus: 'pending',
          agentId: resolvedAgentId,
          attachments: attachmentPreviews,
        };

        set((state) => {
          const nextSessions = withLimitedSessions({
            ...state.sessions,
            [sessionId]: {
              ...state.sessions[sessionId],
              id: sessionId,
              title: state.sessions[sessionId]?.title ?? sessionTitle,
              agentId: resolvedAgentId,
              updatedAt: now,
              model: model ?? state.sessions[sessionId]?.model,
              reasoningEffort: reasoningEffort ?? state.sessions[sessionId]?.reasoningEffort,
              totalTokens: state.sessions[sessionId]?.totalTokens ?? 0,
              estimatedCost: state.sessions[sessionId]?.estimatedCost ?? 0,
              contextCount: state.sessions[sessionId]?.contextCount ?? 0,
              contextLimit: state.sessions[sessionId]?.contextLimit,
              lastUsageAt: state.sessions[sessionId]?.lastUsageAt,
            },
          });
          const validSessionIds = new Set(Object.keys(nextSessions));
          const nextMessagesBySession = pruneMessagesBySessions(appendMessage(state, sessionId, userMessage), nextSessions);
          prunePersistedSessionMessages(validSessionIds);

          return {
            sessions: nextSessions,
            messagesBySession: nextMessagesBySession,
            pendingQueue: appendWithLimit(
              state.pendingQueue,
              {
                messageId: userMessage.id,
                sessionId,
                agentId: resolvedAgentId,
                content: payloadContent,
                model,
                reasoningEffort,
                createdAt: now,
                attachments,
              },
              MAX_PENDING,
            ),
            lastError: null,
          };
        });

        await get().flushPendingQueue();
      },

      retryFailedMessage: async (messageId, sessionId) => {
        const state = get();
        const sourceMessages = state.messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
        const message = sourceMessages.find((item) => item.id === messageId);
        if (!message || message.role !== 'user') {
          return;
        }

        const failedPayload = state.failedOutbound[messageId];
        const retryContent =
          failedPayload?.content ?? (isImageAttachmentPlaceholder(message.content) ? '' : message.content);

        set((state) => ({
          messagesBySession: updateMessage(state, sessionId, messageId, (item) => ({
            ...item,
            syncStatus: 'pending',
          })),
          failedOutbound: (() => {
            const next = { ...state.failedOutbound };
            delete next[messageId];
            return next;
          })(),
          pendingQueue: appendWithLimit(
            state.pendingQueue,
            {
              messageId: message.id,
              sessionId: message.sessionId,
              agentId: message.agentId,
              content: retryContent,
              attachments: failedPayload?.attachments,
              model: failedPayload?.model,
              reasoningEffort: failedPayload?.reasoningEffort,
              createdAt: Date.now(),
            },
            MAX_PENDING,
          ),
        }));

        await get().flushPendingQueue();
      },

      syncSession: async (sessionId) => {
        if (!useConnectionStore.getState().activeProfileId) {
          return;
        }

        const localMessages = get().messagesBySession[sessionId] ?? readPersistedSessionMessages(sessionId);
        if (!get().messagesBySession[sessionId]) {
          set((state) => ({
            messagesBySession: {
              ...state.messagesBySession,
              [sessionId]: localMessages,
            },
          }));
        }

        const localHash = getLatestSyncedHash(localMessages);

        try {
          set({ isSyncing: true });
          const remote = await getSessionLastHash(sessionId);

          if (remote.hash && remote.hash === localHash) {
            return;
          }

          const missing = await getSessionMessages(sessionId, localHash);
          if (!missing.messages.length) {
            return;
          }

          const mapped: LocalChatMessage[] = await Promise.all(
            missing.messages.map(async (item) => ({
              id: item.id,
              sessionId: item.sessionId,
              role: item.role,
              content: item.content,
              timestamp: Date.parse(item.createdAt) || Date.now(),
              hash: await createContentHash(`${item.sessionId}:${item.role}:${item.content}:${item.createdAt}`),
              syncStatus: 'synced',
              agentId: get().sessions[sessionId]?.agentId ?? get().activeAgentId ?? undefined,
            })),
          );

          set((state) => {
            const existing = state.messagesBySession[sessionId] ?? [];
            const existingIds = new Set(existing.map((item) => item.id));
            const next = [...existing, ...mapped.filter((item) => !existingIds.has(item.id))].sort(
              (a, b) => a.timestamp - b.timestamp,
            );
            const limited = next.slice(Math.max(0, next.length - MAX_MESSAGES_PER_SESSION));
            schedulePersistSessionMessages(sessionId, limited);

            return {
              messagesBySession: {
                ...state.messagesBySession,
                [sessionId]: limited,
              },
            };
          });
        } catch {
          return;
        } finally {
          set({ isSyncing: false });
        }
      },

      flushPendingQueue: async () => {
        if (flushingQueue) {
          return;
        }

        if (!useConnectionStore.getState().activeProfileId) {
          return;
        }

        flushingQueue = true;
        set({ isStreaming: true });

        try {
          while (get().pendingQueue.length > 0) {
            const current = get().pendingQueue[0];
            const assistantMessageId = randomId('msg_assistant');
            let timelineSteps: ToolTimelineStep[] = [
              createTimelineStep('reasoning', 'reasoning...', Date.now()),
            ];
            let responseTimelineStarted = false;
            let latestUsage: ChatMessageUsage | null = null;

            set((state) => ({
              messagesBySession: appendMessage(state, current.sessionId, {
                id: assistantMessageId,
                sessionId: current.sessionId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                hash: '',
                syncStatus: 'streaming',
                agentId: current.agentId,
                toolTimeline: timelineSteps,
              }),
            }));

            const abort = new AbortController();
            let bufferedChunk = '';
            let flushTimer: ReturnType<typeof setTimeout> | null = null;

            const syncAssistantMetadata = (): void => {
              set((state) => ({
                messagesBySession: updateMessage(state, current.sessionId, assistantMessageId, (item) => ({
                  ...item,
                  toolTimeline: timelineSteps,
                  usage: latestUsage ?? item.usage,
                })),
              }));
            };

            const appendTimelineStep = (kind: ToolTimelineStep['kind'], label: string, startedAt = Date.now()): void => {
              const normalizedLabel = label.replace(/\s+/g, ' ').trim();
              if (!normalizedLabel) {
                return;
              }

              const previous = timelineSteps[timelineSteps.length - 1];
              if (previous && previous.kind === kind && previous.label === normalizedLabel && previous.status === 'running') {
                return;
              }

              timelineSteps = timelineSteps.map((item, index) =>
                index === timelineSteps.length - 1 && item.status === 'running'
                  ? closeRunningTimelineStep(item, startedAt)
                  : item,
              );
              timelineSteps = [...timelineSteps, createTimelineStep(kind, normalizedLabel, startedAt)];
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

            const flushBufferedChunk = () => {
              if (!bufferedChunk) {
                return;
              }

              const chunk = bufferedChunk;
              bufferedChunk = '';

              set((state) => ({
                messagesBySession: updateMessage(state, current.sessionId, assistantMessageId, (item) => ({
                  ...item,
                  content: item.content + chunk,
                })),
              }));
            };

            try {
              const sendWithCurrentOptions = (overrideModel?: string): Promise<string> =>
                streamChatCompletion({
                  sessionId: current.sessionId,
                  agentId: current.agentId,
                  message: current.content,
                  model: overrideModel,
                  reasoningEffort: current.reasoningEffort,
                  attachments: current.attachments,
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
                    appendTimelineStep(event.kind, event.label);
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
              const assistantHash = await createContentHash(
                `${current.sessionId}:assistant:${content}:${now}`,
              );
              const estimatedTokens =
                estimateTokenCount(current.content) + estimateTokenCount(content);
              const usageTotalTokens = (latestUsage as ChatMessageUsage | null)?.totalTokens ?? 0;
              const tokenIncrement = usageTotalTokens > 0 ? usageTotalTokens : estimatedTokens;

              set((state) => ({
                messagesBySession: (() => {
                  const nextSessionMessages = (state.messagesBySession[current.sessionId] ?? []).map(
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

                  return {
                    ...state.messagesBySession,
                    [current.sessionId]: nextSessionMessages,
                  };
                })(),
                sessions: {
                  ...state.sessions,
                  [current.sessionId]: (() => {
                    const existingSession = state.sessions[current.sessionId];
                    const nextModel = usedGatewayDefaultModel
                      ? undefined
                      : current.model ?? existingSession?.model;
                    const nextTotalTokens = (existingSession?.totalTokens ?? 0) + tokenIncrement;
                    const nextContextCount = latestUsage?.contextTokens ??
                      latestUsage?.promptTokens ??
                      Math.max(existingSession?.contextCount ?? 0, nextTotalTokens);
                    const nextContextLimit = latestUsage?.contextLimit ??
                      existingSession?.contextLimit;
                    return {
                      ...(existingSession ?? {
                        id: current.sessionId,
                        agentId: current.agentId,
                        title: deriveSessionTitle(current.content, current.attachments),
                        model: current.model,
                        reasoningEffort: current.reasoningEffort,
                        totalTokens: 0,
                        estimatedCost: 0,
                        contextCount: 0,
                      }),
                      updatedAt: now,
                      model: nextModel,
                      reasoningEffort:
                        current.reasoningEffort ?? existingSession?.reasoningEffort,
                      totalTokens: nextTotalTokens,
                      estimatedCost: estimateSessionCost(nextTotalTokens, nextModel),
                      contextCount: Math.max(0, Math.floor(nextContextCount)),
                      contextLimit: nextContextLimit,
                      lastUsageAt: now,
                    };
                  })(),
                },
                failedOutbound: (() => {
                  const next = { ...state.failedOutbound };
                  delete next[current.messageId];
                  return next;
                })(),
                pendingQueue: state.pendingQueue.slice(1),
                lastError: null,
              }));
            } catch (error: unknown) {
              abort.abort();
              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              bufferedChunk = '';
              appendTimelineStep('io', 'response failed');
              finalizeTimeline();
              const reason = error instanceof Error ? error.message : 'Unknown chat error';
              const failureNote = normalizeFailureReason(reason);

              if (!useConnectionStore.getState().activeProfileId) {
                set((state) => ({
                  messagesBySession: (() => {
                    const nextSessionMessages = (state.messagesBySession[current.sessionId] ?? []).filter(
                      (item) => item.id !== assistantMessageId,
                    );
                    schedulePersistSessionMessages(current.sessionId, nextSessionMessages);

                    return {
                      ...state.messagesBySession,
                      [current.sessionId]: nextSessionMessages,
                    };
                  })(),
                }));
                break;
              }

              set((state) => ({
                messagesBySession: (() => {
                  const nextSessionMessages = (state.messagesBySession[current.sessionId] ?? []).map(
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

                  return {
                    ...state.messagesBySession,
                    [current.sessionId]: nextSessionMessages,
                  };
                })(),
                failedOutbound: withLimitedFailedOutbound({
                  ...state.failedOutbound,
                  [current.messageId]: current,
                }),
                pendingQueue: state.pendingQueue.slice(1),
                lastError: failureNote,
              }));
              }
            }
        } finally {
          flushingQueue = false;
          set({ isStreaming: false });
        }
      },
    }),
    {
      name: STORAGE_KEYS.CHAT_STORE,
      storage: chatPersistStorage,
      partialize: (state): ChatStorePersistedState => ({
        activeAgentId: state.activeAgentId,
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
        pendingQueue: state.pendingQueue,
        failedOutbound: state.failedOutbound,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const normalizedSessions: Record<string, LocalChatSession> = Object.fromEntries(
          Object.entries(state.sessions).map(([sessionId, session]) => [
            sessionId,
            {
              ...session,
              id: session.id || sessionId,
              title: session.title || sessionId,
              updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
              totalTokens: Number.isFinite(session.totalTokens) ? session.totalTokens : 0,
              estimatedCost: Number.isFinite(session.estimatedCost) ? session.estimatedCost : 0,
              contextCount: Number.isFinite(session.contextCount) ? Math.max(0, Math.floor(session.contextCount)) : 0,
              contextLimit:
                typeof session.contextLimit === 'number' && Number.isFinite(session.contextLimit)
                  ? Math.max(0, Math.floor(session.contextLimit))
                  : undefined,
              lastUsageAt:
                typeof session.lastUsageAt === 'number' && Number.isFinite(session.lastUsageAt)
                  ? session.lastUsageAt
                  : undefined,
            },
          ]),
        );

        useChatStore.setState({ sessions: normalizedSessions });

        const validSessionIds = new Set(Object.keys(normalizedSessions));
        prunePersistedSessionMessages(validSessionIds);

        const migratedMessagesBySession = (
          state as unknown as {
            messagesBySession?: Record<string, LocalChatMessage[]>;
          }
        ).messagesBySession;
        for (const [sessionId, messages] of Object.entries(migratedMessagesBySession ?? {})) {
          schedulePersistSessionMessages(sessionId, messages);
        }

        if (!state.activeSessionId) {
          useChatStore.setState({ messagesBySession: {} });
          return;
        }

        const activeSessionMessages =
          state.messagesBySession?.[state.activeSessionId] ?? readPersistedSessionMessages(state.activeSessionId);
        useChatStore.setState((current) => ({
          messagesBySession: {
            ...current.messagesBySession,
            [state.activeSessionId as string]: activeSessionMessages,
          },
        }));
      },
    },
  ),
);
