import { getGatewayAuthContext } from './gatewayContext';
import { WS_PROTOCOL_VERSION, requestGatewayWs } from '../../../lib/api/gatewayWs';
import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { useAgentActivityStore } from '../store/agentActivityStore';
import type { ChatAttachment, ReasoningEffort } from '../types';

const WS_OPERATOR_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing'];
const WS_IDLE_TIMEOUT_MS = 45000;
const WS_CLIENT_ID = 'openclaw-ios';
const WS_CLIENT_VERSION = '1.0.0';
const WS_CONNECT_FALLBACK_PROFILES: Array<{
  role?: string;
  scopes?: string[];
  mode?: string;
}> = [
  { role: 'operator', scopes: WS_OPERATOR_SCOPES, mode: 'ui' },
  { role: 'operator', scopes: [], mode: 'ui' },
  { role: 'client', scopes: [], mode: 'mobile' },
  { role: 'user', scopes: [] },
  {},
];

interface StreamOptions {
  sessionId: string;
  agentId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  message: string;
  attachments?: ChatAttachment[];
  signal?: AbortSignal;
  onToken: (chunk: string) => void;
  onToolEvent?: (event: {
    kind: 'tool' | 'reasoning' | 'io' | 'response';
    label: string;
    raw?: unknown;
  }) => void;
  onUsage?: (usage: StreamUsageSnapshot) => void;
}

interface StreamResponseChunk {
  delta?: string;
  content?: string;
  choices?: Array<{ delta?: { content?: string }; text?: string }>;
  usage?: unknown;
}

interface StreamUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextTokens?: number;
  contextLimit?: number;
}

interface GatewayWsFrame {
  type?: string;
  id?: string;
  ok?: boolean;
  event?: string;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

type ImageTransportMode = 'gateway_attachments' | 'message_image_url';

interface ChatCompletionRequestPayload {
  stream: true;
  sessionId: string;
  agentId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  reasoning?: {
    effort: ReasoningEffort;
  };
  attachments?: Array<{
    type: ChatAttachment['type'];
    mimeType: string;
    data: string;
    fileName?: string;
  }>;
  messages: Array<{
    role: 'user';
    content: string | Array<Record<string, unknown>>;
  }>;
}

const transportModeByBaseUrl = new Map<string, ImageTransportMode>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTaskSummary(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function resolveAgentName(agentId?: string): string {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) {
    return 'Gateway';
  }

  const runtime = useAgentsRuntimeStore.getState().byId[normalizedAgentId];
  return runtime?.name?.trim() || normalizedAgentId;
}

function startAgentActivity(options: StreamOptions): void {
  const agentId = options.agentId?.trim();
  if (!agentId) {
    return;
  }

  const fallbackTask = normalizeTaskSummary(options.message) || 'Processing request';

  useAgentActivityStore.getState().setActiveAgent({
    agentId,
    agentName: resolveAgentName(agentId),
    currentTask: fallbackTask,
    model: options.model,
    isStreaming: true,
  });
}

function updateAgentActivityTask(task: string): void {
  const normalized = normalizeTaskSummary(task);
  if (!normalized) {
    return;
  }
  useAgentActivityStore.getState().updateTask(normalized);
}

function endAgentActivity(): void {
  useAgentActivityStore.getState().clearActiveAgent();
}

function emitToolEvent(
  options: StreamOptions,
  kind: 'tool' | 'reasoning' | 'io' | 'response',
  label: string,
  raw?: unknown,
): void {
  const normalized = normalizeTaskSummary(label);
  if (!normalized) {
    return;
  }
  options.onToolEvent?.({
    kind,
    label: normalized,
    raw,
  });
}

function extractToolCallName(node: unknown): string | null {
  if (!node) {
    return null;
  }

  if (typeof node === 'string') {
    const normalized = normalizeTaskSummary(node);
    return normalized || null;
  }

  if (!isRecord(node)) {
    return null;
  }

  const directName =
    (typeof node.name === 'string' && node.name) ||
    (typeof node.toolName === 'string' && node.toolName) ||
    (typeof node.tool_call === 'string' && node.tool_call) ||
    '';
  if (directName.trim()) {
    return normalizeTaskSummary(directName);
  }

  const functionNode = isRecord(node.function) ? node.function : undefined;
  if (functionNode && typeof functionNode.name === 'string' && functionNode.name.trim()) {
    return normalizeTaskSummary(functionNode.name);
  }

  return null;
}

function extractToolCallSummary(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const direct = extractToolCallName(payload.toolCall ?? payload.tool_call ?? payload.tool ?? payload.function);
  if (direct) {
    return direct;
  }

  const delta = isRecord(payload.delta) ? payload.delta : undefined;
  if (delta) {
    const directDelta = extractToolCallName(delta.toolCall ?? delta.tool_call ?? delta.tool ?? delta.function);
    if (directDelta) {
      return directDelta;
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const item of toolCalls) {
      const name = extractToolCallName(item);
      if (name) {
        return name;
      }
    }
  }

  const data = isRecord(payload.data) ? payload.data : undefined;
  if (data) {
    const nested = extractToolCallName(data.toolCall ?? data.tool_call ?? data.tool ?? data.function);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractUsageSnapshot(payload: unknown): StreamUsageSnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }

  const usageNode = isRecord(payload.usage) ? payload.usage : payload;
  const promptTokens =
    toNumber(usageNode.prompt_tokens) ??
    toNumber(usageNode.promptTokens) ??
    toNumber(usageNode.input_tokens) ??
    toNumber(usageNode.inputTokens);
  const completionTokens =
    toNumber(usageNode.completion_tokens) ??
    toNumber(usageNode.completionTokens) ??
    toNumber(usageNode.output_tokens) ??
    toNumber(usageNode.outputTokens);
  const totalTokens = toNumber(usageNode.total_tokens) ?? toNumber(usageNode.totalTokens);
  const contextTokens =
    toNumber(usageNode.context_tokens) ??
    toNumber(usageNode.contextTokens) ??
    toNumber(usageNode.cached_tokens) ??
    toNumber(usageNode.cachedTokens);
  const contextLimit =
    toNumber(usageNode.context_limit) ??
    toNumber(usageNode.contextLimit) ??
    toNumber(usageNode.max_context_tokens) ??
    toNumber(usageNode.maxContextTokens);

  const resolvedPrompt = Math.max(0, Math.floor(promptTokens ?? 0));
  const resolvedCompletion = Math.max(0, Math.floor(completionTokens ?? 0));
  const resolvedTotal = Math.max(
    0,
    Math.floor(totalTokens ?? resolvedPrompt + resolvedCompletion),
  );

  if (resolvedTotal <= 0 && resolvedPrompt <= 0 && resolvedCompletion <= 0) {
    return null;
  }

  return {
    promptTokens: resolvedPrompt,
    completionTokens: resolvedCompletion,
    totalTokens: resolvedTotal,
    ...(typeof contextTokens === 'number' ? { contextTokens: Math.max(0, Math.floor(contextTokens)) } : {}),
    ...(typeof contextLimit === 'number' ? { contextLimit: Math.max(0, Math.floor(contextLimit)) } : {}),
  };
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function toHttpOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function createGatewaySocket(baseUrl: string): WebSocket {
  const wsUrl = toWebSocketUrl(baseUrl);
  const origin = toHttpOrigin(baseUrl);

  try {
    const Ctor = WebSocket as unknown as {
      new (
        url: string,
        protocols?: string | string[],
        options?: {
          headers?: Record<string, string>;
        },
      ): WebSocket;
    };

    return new Ctor(wsUrl, undefined, {
      headers: {
        Origin: origin,
      },
    });
  } catch {
    return new WebSocket(wsUrl);
  }
}

function toSessionKey(sessionId: string, agentId?: string): string {
  if (sessionId.includes(':')) {
    return sessionId;
  }

  if (sessionId.startsWith('session_') || sessionId.startsWith('local_')) {
    if (agentId && agentId.trim()) {
      return `agent:${agentId.trim()}:main`;
    }
    return 'main';
  }

  if (agentId && agentId.trim()) {
    return `agent:${agentId.trim()}:${sessionId}`;
  }

  return sessionId;
}

function createIdempotencyKey(): string {
  return `claw-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildConnectPayload(
  token: string,
  profile: { role?: string; scopes?: string[]; mode?: string },
): Record<string, unknown> {
  return {
    minProtocol: WS_PROTOCOL_VERSION,
    maxProtocol: WS_PROTOCOL_VERSION,
    client: {
      id: WS_CLIENT_ID,
      version: WS_CLIENT_VERSION,
      platform: 'ios',
      mode: profile.mode ?? 'ui',
      instanceId: `claw-link-${Date.now()}`,
    },
    ...(profile.role ? { role: profile.role } : {}),
    ...(profile.scopes ? { scopes: profile.scopes } : {}),
    caps: [],
    auth: { token },
    userAgent: 'claw-link',
    locale: 'zh-CN',
  };
}

function shouldRetryConnectProfile(error: unknown): boolean {
  const lowered = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    lowered.includes('scope') ||
    lowered.includes('role') ||
    lowered.includes('permission') ||
    lowered.includes('forbidden') ||
    lowered.includes('unauthorized') ||
    lowered.includes('denied') ||
    lowered.includes('invalid') ||
    lowered.includes('schema') ||
    lowered.includes('connect')
  );
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  let result = '';
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const type = typeof item.type === 'string' ? item.type : '';
    if (type !== 'text') {
      continue;
    }

    const text = typeof item.text === 'string' ? item.text : '';
    if (text) {
      result += text;
    }
  }

  return result;
}

function extractAgentStreamDelta(payload: unknown, previousText: string): { delta: string; fullText: string } {
  if (!isRecord(payload)) {
    return { delta: '', fullText: previousText };
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const delta = typeof data.delta === 'string' ? data.delta : '';
  const fullText = typeof data.text === 'string' ? data.text : previousText;

  if (delta) {
    return { delta, fullText };
  }

  if (fullText.startsWith(previousText)) {
    return { delta: fullText.slice(previousText.length), fullText };
  }

  return { delta: '', fullText };
}

function extractImmediateAssistantText(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }

  const directText =
    (typeof payload.text === 'string' && payload.text) ||
    (typeof payload.content === 'string' && payload.content) ||
    (typeof payload.message === 'string' && payload.message) ||
    (typeof payload.output === 'string' && payload.output) ||
    '';
  if (directText.trim()) {
    return directText.trim();
  }

  const messageNode = isRecord(payload.message) ? payload.message : undefined;
  if (messageNode) {
    const messageContent = normalizeTextContent(messageNode.content);
    if (messageContent.trim()) {
      return messageContent.trim();
    }
  }

  const outputNode = isRecord(payload.output) ? payload.output : undefined;
  if (outputNode) {
    const outputContent = normalizeTextContent(outputNode.content);
    if (outputContent.trim()) {
      return outputContent.trim();
    }
  }

  return '';
}

async function runChatViaWsRequest(options: StreamOptions): Promise<string> {
  const sessionKey = toSessionKey(options.sessionId, options.agentId);
  const messageText = options.message.trim() ? options.message : '[Image]';
  const attachments =
    options.attachments?.map((item) => ({
      type: item.type,
      mimeType: item.mimeType,
      content: item.base64,
      fileName: item.fileName,
      width: item.width,
      height: item.height,
    })) ?? [];

  const candidates = (() => {
    const set = new Set<string>();
    set.add(sessionKey);
    if (options.agentId?.trim()) {
      set.add(`agent:${options.agentId.trim()}:main`);
    }
    set.add('main');
    return Array.from(set);
  })();

  const plans: Array<{ method: string; params: Record<string, unknown> }> = [];
  for (const sessionCandidate of candidates) {
    plans.push(
      {
        method: 'chat.send',
        params: {
          sessionKey: sessionCandidate,
          message: messageText,
          idempotencyKey: createIdempotencyKey(),
          ...(options.model ? { model: options.model } : {}),
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          deliver: false,
        },
      },
      {
        method: 'agent.run',
        params: {
          sessionKey: sessionCandidate,
          agentId: options.agentId,
          model: options.model,
          input: messageText,
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      },
      {
        method: 'chat.create',
        params: {
          sessionKey: sessionCandidate,
          message: messageText,
          ...(options.model ? { model: options.model } : {}),
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      },
    );
  }

  let lastError: unknown = null;
  for (const plan of plans) {
    try {
      const payload = await requestGatewayWs(plan.method, plan.params, { timeoutMs: 30000 });
      const text = extractImmediateAssistantText(payload);
      const usageSnapshot = extractUsageSnapshot(payload);
      if (usageSnapshot) {
        options.onUsage?.(usageSnapshot);
      }
      if (text.trim()) {
        options.onToken(text);
        updateAgentActivityTask(text);
        emitToolEvent(options, 'response', 'response generated', payload);
        return text;
      }

      const record = isRecord(payload) ? payload : {};
      const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';
      if (status === 'ok' || status === 'success') {
        return '';
      }
    } catch (error: unknown) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const retryable =
        message.includes('not found') ||
        message.includes('invalid') ||
        message.includes('schema') ||
        message.includes('expected') ||
        message.includes('session') ||
        message.includes('method');
      if (!retryable) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('chat request failed');
}

async function streamChatViaWebSocket(
  options: StreamOptions,
  baseUrl: string,
  token: string,
): Promise<string> {
  const sessionKey = toSessionKey(options.sessionId, options.agentId);
  const messageText = options.message.trim() ? options.message : '[Image]';

  return new Promise<string>((resolve, reject) => {
    const ws = createGatewaySocket(baseUrl);
    const pending = new Map<
      string,
      {
        method: string;
        timeoutId: ReturnType<typeof setTimeout>;
        resolvePending: (payload: unknown) => void;
        rejectPending: (error: Error) => void;
      }
    >();

    let reqCounter = 0;
    let runId: string | null = null;
    let settled = false;
    let challengeReceived = false;
    let collected = '';
    let assistantText = '';

    const closeAndCleanup = (): void => {
      for (const [, request] of pending) {
        clearTimeout(request.timeoutId);
      }
      pending.clear();

      clearTimeout(handshakeTimer);
      clearTimeout(idleTimer);

      try {
        ws.close();
      } catch {
        // no-op
      }
    };

    const settleResolve = (value: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      closeAndCleanup();
      resolve(value);
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      closeAndCleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const resetIdleTimer = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        settleReject(new Error('gateway websocket stream timed out'));
      }, WS_IDLE_TIMEOUT_MS);
    };

    const sendRequest = (method: string, params: Record<string, unknown>): Promise<unknown> => {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('gateway websocket is not connected'));
      }

      reqCounter += 1;
      const id = `req_${reqCounter}`;

      return new Promise<unknown>((resolvePending, rejectPending) => {
        const timeoutId = setTimeout(() => {
          pending.delete(id);
          rejectPending(new Error(`${method} timeout`));
        }, 12000);

        pending.set(id, { method, timeoutId, resolvePending, rejectPending });
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      });
    };

    let idleTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      settleReject(new Error('gateway websocket stream timed out'));
    }, WS_IDLE_TIMEOUT_MS);
    const handshakeTimer = setTimeout(() => {
      settleReject(new Error('gateway websocket handshake timeout'));
    }, 12000);

    const handleGatewayEvent = (event: string, payload: unknown): void => {
      if (!isRecord(payload)) {
        return;
      }

      const payloadRunId = typeof payload.runId === 'string' ? payload.runId : null;
      if (runId && payloadRunId && payloadRunId !== runId) {
        return;
      }

      resetIdleTimer();

      if (event === 'agent') {
        const stream = typeof payload.stream === 'string' ? payload.stream : '';

        if (stream === 'assistant') {
          const { delta, fullText } = extractAgentStreamDelta(payload, assistantText);
          assistantText = fullText;
          if (delta) {
            collected += delta;
            options.onToken(delta);
            updateAgentActivityTask(assistantText || delta);
            emitToolEvent(options, 'response', 'response generated', payload);
          }

          const usageSnapshot = extractUsageSnapshot(payload);
          if (usageSnapshot) {
            options.onUsage?.(usageSnapshot);
          }
          return;
        }

        if (stream === 'tool' || stream === 'tool_call') {
          const toolName = extractToolCallSummary(payload);
          if (toolName) {
            updateAgentActivityTask(`Using ${toolName}`);
            emitToolEvent(options, 'tool', `called ${toolName}()`, payload);
          }
          return;
        }

        if (stream === 'reasoning') {
          const reasoningText = (() => {
            if (isRecord(payload.data) && typeof payload.data.summary === 'string') {
              return payload.data.summary;
            }
            if (typeof payload.delta === 'string') {
              return payload.delta;
            }
            return 'reasoning...';
          })();
          updateAgentActivityTask(reasoningText);
          emitToolEvent(options, 'reasoning', reasoningText, payload);
          return;
        }

        if (stream === 'lifecycle') {
          const data = isRecord(payload.data) ? payload.data : {};
          const phase = typeof data.phase === 'string' ? data.phase : '';

          if (phase === 'end') {
            settleResolve(collected);
            return;
          }

          if (phase === 'error' || phase === 'failed') {
            const message =
              (typeof data.message === 'string' && data.message.trim()) ||
              (typeof data.error === 'string' && data.error.trim()) ||
              (isRecord(data.error) && typeof data.error.message === 'string' && data.error.message.trim()) ||
              (typeof payload.message === 'string' && payload.message.trim()) ||
              (typeof payload.error === 'string' && payload.error.trim()) ||
              (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) ||
              'chat run failed on gateway';
            settleReject(new Error(message));
          }
        }
        return;
      }

      if (event === 'chat') {
        const state = typeof payload.state === 'string' ? payload.state : '';
        const message = isRecord(payload.message) ? payload.message : {};
        const textFromMessage = normalizeTextContent(message.content);
        const inlineText =
          (typeof payload.text === 'string' && payload.text) ||
          (typeof payload.delta === 'string' && payload.delta) ||
          '';
        const candidateText = textFromMessage || inlineText;
        const toolSummary = extractToolCallSummary(payload);
        if (toolSummary) {
          updateAgentActivityTask(`Using ${toolSummary}`);
          emitToolEvent(options, 'tool', `called ${toolSummary}()`, payload);
        }

        const usageSnapshot = extractUsageSnapshot(payload);
        if (usageSnapshot) {
          options.onUsage?.(usageSnapshot);
        }

        if (state === 'delta' || state === 'streaming') {
          if (!candidateText) {
            return;
          }

          if (candidateText.startsWith(assistantText)) {
            const delta = candidateText.slice(assistantText.length);
            assistantText = candidateText;
            if (delta) {
              collected += delta;
              options.onToken(delta);
              updateAgentActivityTask(candidateText);
              emitToolEvent(options, 'response', 'response generated', payload);
            }
            return;
          }

          assistantText += candidateText;
          collected += candidateText;
          options.onToken(candidateText);
          updateAgentActivityTask(assistantText);
          emitToolEvent(options, 'response', 'response generated', payload);
          return;
        }

        if (state !== 'final' && state !== 'done' && state !== 'completed') {
          return;
        }

        if (candidateText) {
          if (!collected) {
            collected = candidateText;
            options.onToken(candidateText);
          } else if (candidateText.length > collected.length && candidateText.startsWith(collected)) {
            const delta = candidateText.slice(collected.length);
            collected = candidateText;
            if (delta) {
              options.onToken(delta);
              updateAgentActivityTask(candidateText);
              emitToolEvent(options, 'response', 'response generated', payload);
            }
          } else if (!candidateText.startsWith(collected)) {
            collected = candidateText;
          }
        }

        settleResolve(collected || candidateText);
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const rawData = typeof event.data === 'string' ? event.data : '';
      if (!rawData) {
        return;
      }

      let frame: GatewayWsFrame;
      try {
        frame = JSON.parse(rawData) as GatewayWsFrame;
      } catch {
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge' && !challengeReceived) {
        challengeReceived = true;
        clearTimeout(handshakeTimer);
        resetIdleTimer();

        const attachments =
          options.attachments?.map((item) => ({
            type: item.type,
            mimeType: item.mimeType,
            data: item.base64,
            fileName: item.fileName,
            width: item.width,
            height: item.height,
          })) ?? [];

        const sendChatRequest = async (): Promise<unknown> => {
          const sessionKeyCandidates = (() => {
            const set = new Set<string>();
            const normalizedSessionKey = sessionKey.trim();
            if (normalizedSessionKey) {
              set.add(normalizedSessionKey);
            }

            const normalizedAgentId = options.agentId?.trim();
            if (normalizedAgentId) {
              // OpenClaw main session convention.
              set.add(`agent:${normalizedAgentId}:main`);
            }

            if (normalizedSessionKey.startsWith('agent:')) {
              const segments = normalizedSessionKey.split(':');
              if (segments.length >= 2 && segments[1]) {
                set.add(`agent:${segments[1]}:main`);
                set.add(`agent:${segments[1]}:default`);
              }
            }

            set.add('main');

            return Array.from(set);
          })();

          const chatSendCandidates = sessionKeyCandidates.flatMap((candidateSessionKey) => {
            const idempotencyKey = createIdempotencyKey();
            const chatAttachments =
              attachments.length > 0
                ? attachments.map((item) => ({
                    type: item.type,
                    mimeType: item.mimeType,
                    content: item.data,
                  }))
                : undefined;

            const modernPayloads: Array<Record<string, unknown>> = [
              {
                sessionKey: candidateSessionKey,
                message: messageText,
                idempotencyKey,
                deliver: false,
              },
              {
                sessionKey: candidateSessionKey,
                message: messageText,
                idempotencyKey,
                deliver: false,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
              {
                sessionKey: candidateSessionKey,
                message: {
                  role: 'user',
                  content: messageText,
                },
                idempotencyKey,
                deliver: false,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
            ];

            const legacyPayloads: Array<Record<string, unknown>> = [
              {
                sessionId: candidateSessionKey,
                message: messageText,
                idempotencyKey,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
              {
                session: candidateSessionKey,
                message: messageText,
                idempotencyKey,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
              {
                sessionKey: candidateSessionKey,
                text: messageText,
                idempotencyKey,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
              {
                sessionKey: candidateSessionKey,
                content: messageText,
                idempotencyKey,
                ...(chatAttachments ? { attachments: chatAttachments } : {}),
              },
            ];

            return [...modernPayloads, ...legacyPayloads];
          });

          const genericRunCandidates = sessionKeyCandidates.map((candidateSessionKey) => ({
            sessionKey: candidateSessionKey,
            agentId: options.agentId,
            model: options.model,
            input: messageText,
            message: messageText,
            prompt: messageText,
            ...(attachments.length > 0 ? { attachments } : {}),
          }));

          const requestPlans: Array<{ method: string; payload: Record<string, unknown> }> = [
            ...chatSendCandidates.map((payload) => ({
              method: 'chat.send',
              payload,
            })),
            ...genericRunCandidates.map((payload) => ({
              method: 'agent.run',
              payload,
            })),
            ...genericRunCandidates.map((payload) => ({
              method: 'agent.message',
              payload,
            })),
            ...genericRunCandidates.map((payload) => ({
              method: 'chat.create',
              payload,
            })),
          ];

          let lastError: unknown = undefined;
          for (let index = 0; index < requestPlans.length; index += 1) {
            try {
              const plan = requestPlans[index];
              return await sendRequest(plan.method, plan.payload);
            } catch (error: unknown) {
              lastError = error;
              const message = error instanceof Error ? error.message.toLowerCase() : '';
              const retryableFormatError =
                message.includes('invalid') ||
                message.includes('schema') ||
                message.includes('expected') ||
                message.includes('object') ||
                message.includes('string') ||
                message.includes('session') ||
                message.includes('not found') ||
                message.includes('required property');

              if (!retryableFormatError || index === requestPlans.length - 1) {
                break;
              }
            }
          }

          throw lastError instanceof Error ? lastError : new Error('chat send request failed');
        };

        const connectAndSend = async (): Promise<unknown> => {
          let lastError: unknown = new Error('gateway websocket connect failed');

          for (const profile of WS_CONNECT_FALLBACK_PROFILES) {
            try {
              await sendRequest('connect', buildConnectPayload(token, profile));
              return sendChatRequest();
            } catch (error: unknown) {
              lastError = error;
              if (!shouldRetryConnectProfile(error)) {
                throw error;
              }
            }
          }

          throw lastError;
        };

        void connectAndSend()
          .then((payload) => {
            if (isRecord(payload) && typeof payload.runId === 'string') {
              runId = payload.runId;
            }
            if (isRecord(payload) && payload.status === 'failed') {
              const reason =
                (typeof payload.message === 'string' && payload.message.trim()) ||
                (typeof payload.error === 'string' && payload.error.trim()) ||
                (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) ||
                'chat send request failed';
              throw new Error(reason);
            }

            const immediateText = extractImmediateAssistantText(payload);
            const usageSnapshot = extractUsageSnapshot(payload);
            if (usageSnapshot) {
              options.onUsage?.(usageSnapshot);
            }
            if (immediateText) {
              collected = immediateText;
              options.onToken(immediateText);
              updateAgentActivityTask(immediateText);
              emitToolEvent(options, 'response', 'response generated', payload);
              settleResolve(immediateText);
            }
          })
          .catch((error: unknown) => {
            settleReject(error);
          });
        return;
      }

      if (frame.type === 'res' && typeof frame.id === 'string') {
        const pendingRequest = pending.get(frame.id);
        if (!pendingRequest) {
          return;
        }

        clearTimeout(pendingRequest.timeoutId);
        pending.delete(frame.id);

        if (frame.ok) {
          pendingRequest.resolvePending(frame.payload);
        } else {
          const codePrefix = frame.error?.code ? `${frame.error.code}: ` : '';
          const message = frame.error?.message ?? 'gateway request failed';
          pendingRequest.rejectPending(new Error(`${pendingRequest.method} -> ${codePrefix}${message}`));
        }
        return;
      }

      if (frame.type === 'event' && typeof frame.event === 'string') {
        handleGatewayEvent(frame.event, frame.payload);
      }
    };

    ws.onerror = () => {
      settleReject(new Error('gateway websocket connection failed'));
    };

    ws.onclose = (event: CloseEvent) => {
      if (settled) {
        return;
      }

      const reason = event.reason?.trim() || 'gateway websocket closed unexpectedly';
      settleReject(new Error(reason));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        settleReject(new Error('chat request aborted'));
      } else {
        options.signal.addEventListener(
          'abort',
          () => {
            settleReject(new Error('chat request aborted'));
          },
          { once: true },
        );
      }
    }
  });
}

function extractDelta(payload: StreamResponseChunk): string {
  if (typeof payload.delta === 'string') {
    return payload.delta;
  }

  if (typeof payload.content === 'string') {
    return payload.content;
  }

  const first = payload.choices?.[0];
  if (!first) {
    return '';
  }

  return first.delta?.content ?? first.text ?? '';
}

function parseSseFrame(frame: string): string[] {
  const lines = frame.split('\n');
  const dataLines = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  return dataLines;
}

function buildLegacyUserContentPayload(
  message: string,
  attachments?: ChatAttachment[],
): string | Array<Record<string, unknown>> {
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const payload: Array<Record<string, unknown>> = [];

  if (message.trim()) {
    payload.push({
      type: 'text',
      text: message,
    });
  }

  for (const attachment of attachments) {
    if (attachment.type !== 'image') {
      continue;
    }

    payload.push({
      type: 'image_url',
      image_url: {
        url: `data:${attachment.mimeType};base64,${attachment.base64}`,
      },
    });
  }

  return payload;
}

function buildGatewayAttachments(
  attachments?: ChatAttachment[],
): ChatCompletionRequestPayload['attachments'] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  return attachments.map((item) => ({
    type: item.type,
    mimeType: item.mimeType,
    data: item.base64,
    fileName: item.fileName,
  }));
}

function buildRequestPayload(options: StreamOptions, mode: ImageTransportMode): ChatCompletionRequestPayload {
  const hasAttachments = (options.attachments?.length ?? 0) > 0;
  const useLegacyContent = hasAttachments && mode === 'message_image_url';

  const payload: ChatCompletionRequestPayload = {
    stream: true,
    sessionId: options.sessionId,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    reasoning: options.reasoningEffort ? { effort: options.reasoningEffort } : undefined,
    attachments: useLegacyContent ? undefined : buildGatewayAttachments(options.attachments),
    messages: [
      {
        role: 'user',
        content: useLegacyContent
          ? buildLegacyUserContentPayload(options.message, options.attachments)
          : options.message,
      },
    ],
  };

  if (options.agentId) {
    payload.agentId = options.agentId;
  }

  return payload;
}

function shouldRetryWithLegacyImageMode(status: number, bodyText: string): boolean {
  if (![400, 415, 422].includes(status)) {
    return false;
  }

  if (!bodyText.trim()) {
    return true;
  }

  return /(attachment|unsupported|unknown|unexpected|schema|invalid|image_url)/i.test(bodyText);
}

function toHttpError(status: number, bodyText: string): Error {
  return new Error(`HTTP ${status}: ${bodyText || 'stream failed'}`);
}

function shouldFallbackToWebSocket(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (message.includes('http 401') || message.includes('http 403')) {
    return false;
  }

  if (message.includes('http 404')) {
    return true;
  }

  if (message.includes('http 405') || message.includes('http 415') || message.includes('http 501')) {
    return true;
  }

  if (message.includes('http 400') || message.includes('http 422')) {
    return true;
  }

  if (message.includes('network request failed') || message.includes('load failed')) {
    return true;
  }

  if (message.includes('not found') && message.includes('/api/chat/')) {
    return true;
  }

  return false;
}

async function requestStream(
  baseUrl: string,
  token: string,
  signal: AbortSignal | undefined,
  payload: ChatCompletionRequestPayload,
): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function streamChatCompletion(options: StreamOptions): Promise<string> {
  startAgentActivity(options);
  try {
    const { baseUrl, token } = await getGatewayAuthContext();
    return await streamChatCompletionWithFallback(options, baseUrl, token);
  } finally {
    endAgentActivity();
  }
}

async function streamChatCompletionWithFallback(
  options: StreamOptions,
  baseUrl: string,
  token: string,
): Promise<string> {
  try {
    const hasAttachments = (options.attachments?.length ?? 0) > 0;
    const cachedMode = transportModeByBaseUrl.get(baseUrl);
    const primaryMode = hasAttachments ? cachedMode ?? 'gateway_attachments' : 'gateway_attachments';
    let response = await requestStream(
      baseUrl,
      token,
      options.signal,
      buildRequestPayload(options, primaryMode),
    );

    if (!response.ok) {
      const primaryText = await response.text();

      if (hasAttachments && primaryMode === 'gateway_attachments' && shouldRetryWithLegacyImageMode(response.status, primaryText)) {
        const fallbackMode: ImageTransportMode = 'message_image_url';
        response = await requestStream(
          baseUrl,
          token,
          options.signal,
          buildRequestPayload(options, fallbackMode),
        );

        if (response.ok) {
          transportModeByBaseUrl.set(baseUrl, fallbackMode);
        } else {
          const fallbackText = await response.text();
          throw toHttpError(response.status, fallbackText);
        }
      } else {
        throw toHttpError(response.status, primaryText);
      }
    } else if (hasAttachments && primaryMode === 'gateway_attachments') {
      transportModeByBaseUrl.set(baseUrl, primaryMode);
    }

    if (!response.body) {
      throw new Error('Stream body unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let collected = '';
    let buffered = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });
      const frames = buffered.split('\n\n');
      buffered = frames.pop() ?? '';

      for (const frame of frames) {
        const parts = parseSseFrame(frame);
        for (const part of parts) {
          if (part === '[DONE]') {
            return collected;
          }

          try {
            const parsedUnknown = JSON.parse(part) as unknown;
            const toolSummary = extractToolCallSummary(parsedUnknown);
            if (toolSummary) {
              updateAgentActivityTask(`Using ${toolSummary}`);
              emitToolEvent(options, 'tool', `called ${toolSummary}()`, parsedUnknown);
            }

            const usageSnapshot = extractUsageSnapshot(parsedUnknown);
            if (usageSnapshot) {
              options.onUsage?.(usageSnapshot);
            }

            if (!isRecord(parsedUnknown)) {
              continue;
            }

            const parsed = parsedUnknown as StreamResponseChunk;
            const delta = extractDelta(parsed);
            if (!delta) {
              continue;
            }
            collected += delta;
            options.onToken(delta);
            updateAgentActivityTask(collected);
            emitToolEvent(options, 'response', 'response generated', parsedUnknown);
          } catch {
            continue;
          }
        }
      }
    }

    return collected;
  } catch (error: unknown) {
    if (!shouldFallbackToWebSocket(error)) {
      throw error;
    }
    try {
      return await streamChatViaWebSocket(options, baseUrl, token);
    } catch (wsError: unknown) {
      return runChatViaWsRequest(options).catch((requestError: unknown) => {
        if (requestError instanceof Error) {
          throw requestError;
        }
        if (wsError instanceof Error) {
          throw wsError;
        }
        throw error;
      });
    }
  }
}
