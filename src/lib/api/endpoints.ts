import { z } from 'zod';

import {
  ActionResponseSchema,
  AgentDetailResponseSchema,
  AgentLogsResponseSchema,
  AgentsResponseSchema,
  ChannelsResponseSchema,
  CreateAgentRequestSchema,
  CreateAgentResponseSchema,
  DashboardSnapshotResponseSchema,
  DevicesResponseSchema,
  HealthResponseSchema,
  LatencyStatsResponseSchema,
  ModelsResponseSchema,
  RequestsStatsResponseSchema,
  SessionLastHashResponseSchema,
  SessionMessagesResponseSchema,
  SessionsSummaryResponseSchema,
  SkillsResponseSchema,
  TokenStatsResponseSchema,
  UsageSummaryResponseSchema,
  type ActionResponse,
  type AgentDetailResponse,
  type AgentLogsResponse,
  type AgentsResponse,
  type ChannelsResponse,
  type CreateAgentRequest,
  type CreateAgentResponse,
  type DashboardSnapshotResponse,
  type DevicesResponse,
  type HealthResponse,
  type LatencyStatsResponse,
  type ModelsResponse,
  type RequestsStatsResponse,
  type SessionLastHashResponse,
  type SessionMessagesResponse,
  type SessionsSummaryResponse,
  type SkillsResponse,
  type TokenStatsResponse,
  type UsageSummaryResponse,
} from '../schemas';
import { useConnectionStore } from '../../features/connection/store/connectionStore';
import { apiClient, apiGet, apiPost } from './client';
import { requestGatewayWs } from './gatewayWs';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_AGENT_WORKSPACE = '~';

type JsonRecord = Record<string, unknown>;

export interface CostHistoryPoint {
  date: string;
  tokens: number;
  cost: number;
  requests: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const asMilliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(asMilliseconds).toISOString();
  }

  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function parseWsArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function inferWorkspaceFromSessionPath(pathValue: unknown): string | undefined {
  const normalized = toNonEmptyString(pathValue);
  if (!normalized) {
    return undefined;
  }

  // Typical OpenClaw session path:
  // /Users/name/.openclaw/agents/main/sessions/sessions.json
  const marker = '/.openclaw/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex > 0) {
    return normalized.slice(0, markerIndex);
  }

  return undefined;
}

function inferWorkspaceFromStatusPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const directSessionPath = inferWorkspaceFromSessionPath(payload.sessions && isRecord(payload.sessions) ? payload.sessions.path : undefined);
  if (directSessionPath) {
    return directSessionPath;
  }

  const agents = Array.isArray(payload.agents) ? payload.agents.filter(isRecord) : [];
  for (const agent of agents) {
    const sessions = isRecord(agent.sessions) ? agent.sessions : undefined;
    const workspace = inferWorkspaceFromSessionPath(sessions?.path);
    if (workspace) {
      return workspace;
    }
  }

  return undefined;
}

async function resolveAgentWorkspace(): Promise<string> {
  try {
    const statusPayload = await requestGatewayWs('status', {});
    const inferred = inferWorkspaceFromStatusPayload(statusPayload);
    if (inferred) {
      return inferred;
    }
  } catch {
    // Best effort; fallback below.
  }

  return DEFAULT_AGENT_WORKSPACE;
}

function extractAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }

  const match = /^agent:([^:]+):/.exec(sessionKey);
  return match?.[1];
}

function extractCreatedAgentId(payload: unknown, fallbackName: string): string {
  const fromString = toNonEmptyString(payload);
  if (fromString) {
    return fromString;
  }

  if (isRecord(payload)) {
    const directId = toNonEmptyString(payload.agentId) ?? toNonEmptyString(payload.id);
    if (directId) {
      return directId;
    }

    const nestedAgent = isRecord(payload.agent) ? payload.agent : undefined;
    const nestedId = toNonEmptyString(nestedAgent?.id) ?? toNonEmptyString(nestedAgent?.agentId);
    if (nestedId) {
      return nestedId;
    }
  }

  return fallbackName;
}

function extractGatewayFailureReason(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const status = toNonEmptyString(payload.status)?.toLowerCase();
  if (
    payload.ok === false ||
    payload.success === false ||
    status === 'failed' ||
    status === 'error' ||
    status === 'rejected'
  ) {
    const nestedError = isRecord(payload.error) ? payload.error : undefined;
    const details = Array.isArray(payload.details) ? payload.details.join(' | ') : undefined;

    return (
      toNonEmptyString(payload.message) ??
      toNonEmptyString(payload.reason) ??
      toNonEmptyString(payload.code) ??
      toNonEmptyString(payload.error) ??
      toNonEmptyString(nestedError?.message) ??
      toNonEmptyString(nestedError?.code) ??
      toNonEmptyString(details) ??
      'gateway rejected request'
    );
  }

  return undefined;
}

function normalizeSessionIdCandidates(sessionId: string): string[] {
  const normalized = sessionId.trim();
  const candidates = new Set<string>();

  if (normalized) {
    candidates.add(normalized);
  }

  if (normalized && !normalized.includes(':')) {
    candidates.add(`session:${normalized}`);
  }

  const agentFromSession = extractAgentIdFromSessionKey(normalized);
  if (agentFromSession) {
    candidates.add(`agent:${agentFromSession}:main`);
    candidates.add(`agent:${agentFromSession}:default`);
  }

  candidates.add('main');
  return Array.from(candidates);
}

function normalizeCostHistoryDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeCostHistoryPayload(payload: unknown): CostHistoryPoint[] {
  const root = isRecord(payload) ? payload : {};
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(root.history)
      ? root.history
      : Array.isArray(root.days)
        ? root.days
        : Array.isArray(root.points)
          ? root.points
          : Array.isArray(root.items)
            ? root.items
            : isRecord(root.costHistory) && Array.isArray(root.costHistory.days)
              ? root.costHistory.days
              : [];

  if (!Array.isArray(source)) {
    return [];
  }

  const normalized = source
    .map((item): CostHistoryPoint | null => {
      if (!isRecord(item)) {
        return null;
      }

      const date =
        normalizeCostHistoryDate(item.date) ??
        normalizeCostHistoryDate(item.day) ??
        normalizeCostHistoryDate(item.timestamp);
      if (!date) {
        return null;
      }

      const tokens =
        toNumber(item.tokens) ??
        toNumber(item.totalTokens) ??
        toNumber(item.tokenUsage) ??
        toNumber(item.token_usage) ??
        0;
      const cost =
        toNumber(item.cost) ??
        toNumber(item.estimatedCost) ??
        toNumber(item.estimated_cost) ??
        toNumber(item.totalCost) ??
        0;
      const requests =
        toNumber(item.requests) ??
        toNumber(item.requestCount) ??
        toNumber(item.request_count) ??
        toNumber(item.totalRequests) ??
        0;

      return {
        date,
        tokens: Math.max(0, Math.floor(tokens)),
        cost: Math.max(0, Number(cost)),
        requests: Math.max(0, Math.floor(requests)),
      };
    })
    .filter((item): item is CostHistoryPoint => item !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  return normalized;
}

function normalizeWsChatMessages(payload: unknown, fallbackSessionId: string): Array<{
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  model?: string;
}> {
  const record = isRecord(payload) ? payload : {};
  const source = parseWsArray(record.messages ?? record.items ?? record.events ?? payload);

  return source
    .map((item, index) => {
      const id =
        toNonEmptyString(item.id) ??
        toNonEmptyString(item.messageId) ??
        `${fallbackSessionId}:ws:${index}`;
      const sessionId =
        toNonEmptyString(item.sessionId) ??
        toNonEmptyString(item.sessionKey) ??
        fallbackSessionId;
      const roleRaw =
        toNonEmptyString(item.role)?.toLowerCase() ??
        toNonEmptyString(item.sender)?.toLowerCase() ??
        toNonEmptyString(item.author)?.toLowerCase() ??
        'assistant';
      const role: 'system' | 'user' | 'assistant' | 'tool' =
        roleRaw === 'system' || roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'tool'
          ? roleRaw
          : roleRaw === 'human'
            ? 'user'
            : roleRaw === 'bot'
              ? 'assistant'
              : 'assistant';
      const content =
        toNonEmptyString(item.content) ??
        toNonEmptyString(item.text) ??
        toNonEmptyString(item.message) ??
        '';
      const createdAt =
        toIsoDate(item.createdAt) ??
        toIsoDate(item.timestamp) ??
        toIsoDate(item.time) ??
        new Date().toISOString();
      const model = toNonEmptyString(item.model);

      return {
        id,
        sessionId,
        role,
        content,
        createdAt,
        model,
      };
    })
    .filter((item) => item.content.trim().length > 0);
}

async function getSessionMessagesViaWs(sessionId: string, afterHash?: string): Promise<SessionMessagesResponse> {
  const candidates = normalizeSessionIdCandidates(sessionId);
  const plans: Array<{ method: string; params: Record<string, unknown> }> = [];

  for (const candidate of candidates) {
    plans.push(
      { method: 'sessions.messages', params: { sessionId: candidate, ...(afterHash ? { afterHash } : {}) } },
      { method: 'sessions.messages', params: { sessionKey: candidate, ...(afterHash ? { afterHash } : {}) } },
      { method: 'session.messages', params: { sessionId: candidate, ...(afterHash ? { afterHash } : {}) } },
      { method: 'session.history', params: { sessionId: candidate, ...(afterHash ? { afterHash } : {}) } },
      { method: 'chat.history', params: { sessionId: candidate, ...(afterHash ? { afterHash } : {}) } },
      { method: 'chat.messages', params: { sessionId: candidate, ...(afterHash ? { afterHash } : {}) } },
    );
  }

  let fallbackMessages: ReturnType<typeof normalizeWsChatMessages> = [];
  for (const plan of plans) {
    try {
      const payload = await requestGatewayWs(plan.method, plan.params, { timeoutMs: 15000 });
      const messages = normalizeWsChatMessages(payload, sessionId);
      if (messages.length > 0) {
        return SessionMessagesResponseSchema.parse({
          sessionId,
          messages,
        });
      }
      fallbackMessages = messages;
    } catch {
      // keep trying
    }
  }

  return SessionMessagesResponseSchema.parse({
    sessionId,
    messages: fallbackMessages,
  });
}

function mapAgentStatus(agent: JsonRecord): 'active' | 'idle' | 'error' | 'disabled' {
  if (toBoolean(agent.disabled) || (typeof agent.enabled === 'boolean' && agent.enabled === false)) {
    return 'disabled';
  }

  if (typeof agent.status === 'string') {
    const normalized = agent.status.toLowerCase();
    if (normalized === 'active' || normalized === 'idle' || normalized === 'error' || normalized === 'disabled') {
      return normalized;
    }
  }

  if (toBoolean(agent.running) || toBoolean(agent.online) || toBoolean(agent.connected)) {
    return 'active';
  }

  if (typeof agent.lastError === 'string' && agent.lastError.trim()) {
    return 'error';
  }

  return 'idle';
}

function normalizeWsLogLine(rawLine: string): string {
  try {
    const parsed = JSON.parse(rawLine) as unknown;
    if (!isRecord(parsed)) {
      return rawLine;
    }

    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }

    const fragments: string[] = [];
    for (const key of ['0', '1', '2', '3']) {
      const value = parsed[key];
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'string') {
        fragments.push(value);
      } else {
        try {
          fragments.push(JSON.stringify(value));
        } catch {
          fragments.push(String(value));
        }
      }
    }

    if (fragments.length > 0) {
      return fragments.join(' ');
    }

    return rawLine;
  } catch {
    return rawLine;
  }
}

function buildHourlySeries(windowHours: number, events: Array<{ timestampMs: number; count: number }>): Array<{ timestamp: string; count: number }> {
  const now = Date.now();
  const start = now - (windowHours - 1) * HOUR_MS;
  const points = Array.from({ length: windowHours }, (_, index) => ({
    timestamp: new Date(start + index * HOUR_MS).toISOString(),
    count: 0,
  }));

  for (const event of events) {
    const timestampMs = event.timestampMs;
    if (!Number.isFinite(timestampMs) || timestampMs < start || timestampMs > now) {
      continue;
    }

    const bucketIndex = Math.min(windowHours - 1, Math.max(0, Math.floor((timestampMs - start) / HOUR_MS)));
    points[bucketIndex].count += event.count;
  }

  return points;
}

async function getSessionsListViaWs(): Promise<JsonRecord[]> {
  const wsPayload = await requestGatewayWs('sessions.list', {});

  if (isRecord(wsPayload) && Array.isArray(wsPayload.sessions)) {
    return parseWsArray(wsPayload.sessions);
  }

  return parseWsArray(wsPayload);
}

export async function getHealth(): Promise<HealthResponse> {
  try {
    return await apiGet('/api/health', HealthResponseSchema);
  } catch {
    const wsPayload = await requestGatewayWs('health', {});
    const wsRecord = isRecord(wsPayload) ? wsPayload : {};
    const state = useConnectionStore.getState();
    const profile = state.activeProfileId
      ? state.profiles.find((item) => item.id === state.activeProfileId)
      : null;
    const uptimeSeconds = profile?.lastConnectedAt
      ? Math.max(0, Math.floor((Date.now() - profile.lastConnectedAt) / 1000))
      : 0;

    return HealthResponseSchema.parse({
      status: toBoolean(wsRecord.ok) ? 'ok' : 'degraded',
      uptimeSeconds,
      timestamp: toIsoDate(wsRecord.ts) ?? new Date().toISOString(),
    });
  }
}

export async function getDevices(): Promise<DevicesResponse> {
  return apiGet('/api/devices', DevicesResponseSchema);
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshotResponse> {
  return apiGet('/api/stats/dashboard', DashboardSnapshotResponseSchema);
}

export async function getCostHistory(days: number): Promise<CostHistoryPoint[] | null> {
  const normalizedDays = Math.max(1, Math.min(120, Math.floor(days)));
  const candidatePaths = [
    `/api/stats/cost-history?days=${normalizedDays}`,
    `/api/stats/cost?period=${normalizedDays}d`,
    `/api/usage/cost?period=${normalizedDays}d`,
    `/api/usage/history?period=${normalizedDays}d`,
  ];

  for (const path of candidatePaths) {
    try {
      const payload = await apiGet(path, z.unknown());
      const normalized = normalizeCostHistoryPayload(payload);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Try the next candidate.
    }
  }

  try {
    const snapshotPayload = await apiClient.get<unknown>(`/api/stats/dashboard?days=${normalizedDays}`);
    const normalized = normalizeCostHistoryPayload(snapshotPayload.data);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export async function getRequestStats(period: string): Promise<RequestsStatsResponse> {
  try {
    return await apiGet(`/api/stats/requests?period=${encodeURIComponent(period)}`, RequestsStatsResponseSchema);
  } catch {
    const sessions = await getSessionsListViaWs();

    const events = sessions
      .map((session) => ({
        timestampMs: toNumber(session.updatedAt) ?? 0,
        count: 1,
      }))
      .filter((event) => event.timestampMs > 0);

    const points = (() => {
      if (period === 'today') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const nowMs = now.getTime();
        const spanHours = Math.max(1, Math.ceil((nowMs - startOfDay) / HOUR_MS));
        return buildHourlySeries(spanHours, events);
      }

      const normalized = period.trim().toLowerCase();
      const dayMatch = normalized.match(/^(\d+)d$/);
      if (dayMatch) {
        const days = Math.max(1, Number(dayMatch[1]));
        return buildHourlySeries(Math.min(720, days * 24), events);
      }

      const hourMatch = normalized.match(/^(\d+)h$/);
      if (hourMatch) {
        const hours = Math.max(1, Number(hourMatch[1]));
        return buildHourlySeries(Math.min(720, hours), events);
      }

      if (normalized === '24h') {
        return buildHourlySeries(24, events);
      }

      return buildHourlySeries(24, events);
    })();

    const total = points.reduce((sum, item) => sum + item.count, 0);

    return RequestsStatsResponseSchema.parse({
      period,
      total,
      trend: {
        direction: 'flat',
        percentage: 0,
      },
      points,
    });
  }
}

export async function getTokenStats(period: string): Promise<TokenStatsResponse> {
  try {
    return await apiGet(`/api/stats/tokens?period=${encodeURIComponent(period)}`, TokenStatsResponseSchema);
  } catch {
    const sessions = await getSessionsListViaWs();
    let allowedModels: Set<string> | null = null;
    try {
      const models = await getModels();
      const ids = models.models
        .map((item) => item.id.trim())
        .filter((item) => item.length > 0 && !/\blegacy alias\b/i.test(item));
      if (ids.length > 0) {
        allowedModels = new Set(ids);
      }
    } catch {
      allowedModels = null;
    }
    const byModelMap = new Map<string, number>();

    for (const session of sessions) {
      const model = typeof session.model === 'string' && session.model.trim() ? session.model : 'unknown';
      if (allowedModels && !allowedModels.has(model)) {
        continue;
      }
      const totalTokens =
        toNumber(session.totalTokens) ??
        ((toNumber(session.inputTokens) ?? 0) +
          (toNumber(session.outputTokens) ?? 0) +
          (toNumber(session.cacheRead) ?? 0) +
          (toNumber(session.cacheWrite) ?? 0));

      byModelMap.set(model, (byModelMap.get(model) ?? 0) + Math.max(0, Math.floor(totalTokens)));
    }

    const byModel = Array.from(byModelMap.entries()).map(([model, tokens]) => ({ model, tokens }));
    const total = byModel.reduce((sum, item) => sum + item.tokens, 0);

    return TokenStatsResponseSchema.parse({
      total,
      byModel,
    });
  }
}

export async function getLatencyStats(period: string): Promise<LatencyStatsResponse> {
  try {
    return await apiGet(`/api/stats/latency?period=${encodeURIComponent(period)}`, LatencyStatsResponseSchema);
  } catch {
    const wsPayload = await requestGatewayWs('health', {});
    const wsRecord = isRecord(wsPayload) ? wsPayload : {};
    const probeDuration = Math.max(0, Math.floor(toNumber(wsRecord.durationMs) ?? 0));

    return LatencyStatsResponseSchema.parse({
      unit: 'ms',
      p50: probeDuration,
      p95: probeDuration,
      p99: probeDuration,
    });
  }
}

export async function getAgents(): Promise<AgentsResponse> {
  try {
    return await apiGet('/api/agents', AgentsResponseSchema);
  } catch {
    const wsPayload = await requestGatewayWs('agents.list', {});
    const wsRecord = isRecord(wsPayload) ? wsPayload : {};
    const wsAgents = parseWsArray(wsRecord.agents ?? wsPayload);

    const agents = wsAgents.map((agent) => {
      const id = typeof agent.id === 'string' ? agent.id : typeof agent.agentId === 'string' ? agent.agentId : 'unknown';
      return {
        id,
        name: typeof agent.name === 'string' && agent.name.trim() ? agent.name : id,
        model: typeof agent.model === 'string' ? agent.model : undefined,
        status: mapAgentStatus(agent),
        lastActiveAt: toIsoDate(agent.lastActiveAt),
        conversationCount: Math.max(0, Math.floor(toNumber(agent.conversationCount) ?? toNumber(agent.sessionCount) ?? 0)),
      };
    });

    return AgentsResponseSchema.parse({ agents });
  }
}

export async function createAgent(payload: CreateAgentRequest): Promise<CreateAgentResponse> {
  const parsedPayload = CreateAgentRequestSchema.parse(payload);
  const apiCreatePaths = ['/api/agents', '/api/agents/create', '/api/agent/create', '/api/agents/new'];
  const apiErrors: string[] = [];
  for (const path of apiCreatePaths) {
    try {
      return await apiPost(path, parsedPayload, CreateAgentResponseSchema, { skipRetry: true });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      apiErrors.push(`${path}: ${reason}`);
      if (/http 401|http 403|forbidden|permission|read-only|readonly/i.test(reason)) {
        throw error;
      }
    }
  }

  {
      const preferredWorkspace = await resolveAgentWorkspace();
      const candidateWorkspaces = preferredWorkspace === DEFAULT_AGENT_WORKSPACE
        ? [DEFAULT_AGENT_WORKSPACE]
        : [preferredWorkspace, DEFAULT_AGENT_WORKSPACE];
      const normalizedPrompt = parsedPayload.systemPrompt?.trim();

      const candidatePayloads = candidateWorkspaces.flatMap((workspace) => {
        const payloads: Array<{ label: string; payload: Record<string, unknown> }> = [
          {
            label: 'name+workspace',
            payload: {
              name: parsedPayload.name,
              workspace,
            },
          },
          {
            label: 'name only',
            payload: {
              name: parsedPayload.name,
            },
          },
        ];

        if (parsedPayload.model || normalizedPrompt) {
          payloads.push({
            label: 'name+workspace+config',
            payload: {
              name: parsedPayload.name,
              workspace,
              ...(parsedPayload.model ? { model: parsedPayload.model } : {}),
              ...(normalizedPrompt ? { systemPrompt: normalizedPrompt } : {}),
            },
          });
          payloads.push({
            label: 'agent object',
            payload: {
              workspace,
              agent: {
                name: parsedPayload.name,
                ...(parsedPayload.model ? { model: parsedPayload.model } : {}),
                ...(normalizedPrompt ? { systemPrompt: normalizedPrompt } : {}),
              },
            },
          });
        }

        return payloads;
      });
      const createMethods = ['agents.create', 'agent.create', 'agents.add', 'agent.add'];

      let createdPayload: unknown = undefined;
      let lastCreateError: unknown = undefined;
      const createErrors: string[] = [];

      for (const method of createMethods) {
        for (const candidate of candidatePayloads) {
          try {
            createdPayload = await requestGatewayWs(method, candidate.payload);
            lastCreateError = undefined;
            break;
          } catch (error: unknown) {
            lastCreateError = error;
            const reason = error instanceof Error ? error.message : String(error);
            createErrors.push(`${method} ${candidate.label}: ${reason}`);
          }
        }

        if (!lastCreateError) {
          break;
        }
      }

      if (lastCreateError) {
        const compactApiErrors = apiErrors.slice(-2);
        const compactCreateErrors = createErrors.slice(-3);
        throw new Error(
          [...compactApiErrors, ...compactCreateErrors].join(' | ') ||
            (lastCreateError instanceof Error ? lastCreateError.message : 'agents.create failed'),
        );
      }

      const failureReason = extractGatewayFailureReason(createdPayload);

      if (failureReason) {
        throw new Error(failureReason);
      }

      const desiredPatch: Record<string, unknown> = {};
      if (parsedPayload.model) {
        desiredPatch.model = parsedPayload.model;
      }
      if (normalizedPrompt) {
        desiredPatch.systemPrompt = normalizedPrompt;
      }

      if (Object.keys(desiredPatch).length > 0) {
        // Some gateways persist newly-created agents asynchronously.
        const createdAgentId = extractCreatedAgentId(createdPayload, parsedPayload.name);
        const updateCandidates: Array<Record<string, unknown>> = [
          {
            agentId: createdAgentId,
            patch: desiredPatch,
          },
          {
            agentId: createdAgentId,
            ...desiredPatch,
          },
          {
            id: createdAgentId,
            patch: desiredPatch,
          },
          {
            id: createdAgentId,
            ...desiredPatch,
          },
          {
            agentId: createdAgentId,
            config: desiredPatch,
          },
          {
            name: createdAgentId,
            patch: desiredPatch,
          },
          {
            name: createdAgentId,
            ...desiredPatch,
          },
        ];
        const updateMethods = ['agents.update', 'agent.update'];

        for (let attempt = 0; attempt < 4; attempt += 1) {
          let updated = false;
          let retryableNotFound = false;

          for (const method of updateMethods) {
            for (const updatePayload of updateCandidates) {
              try {
                await requestGatewayWs(method, updatePayload);
                updated = true;
                break;
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message.toLowerCase() : '';
                if (message.includes('not found') || message.includes('unknown agent')) {
                  retryableNotFound = true;
                }
              }
            }

            if (updated) {
              break;
            }
          }

          if (updated) {
            break;
          }

          if (!retryableNotFound || attempt === 3) {
            break;
          }

          await sleep(250 * (attempt + 1));
        }
      }

      return CreateAgentResponseSchema.parse({
        success: true,
        message:
          parsedPayload.systemPrompt || parsedPayload.model
            ? 'Agent created. Gateway may apply model/prompt asynchronously depending on version.'
            : 'Agent created successfully.',
        agent: isRecord(createdPayload) ? createdPayload : undefined,
      });
  }
}

export async function getAgentDetail(agentId: string): Promise<AgentDetailResponse> {
  try {
    return await apiGet(`/api/agents/${agentId}`, AgentDetailResponseSchema);
  } catch {
    const agents = await getAgents();
    const matched = agents.agents.find((agent) => agent.id === agentId);

    return AgentDetailResponseSchema.parse({
      agent: {
        id: matched?.id ?? agentId,
        name: matched?.name ?? agentId,
        model: matched?.model,
        status: matched?.status ?? 'idle',
        lastActiveAt: matched?.lastActiveAt,
        conversationCount: matched?.conversationCount,
        config: {},
        assignedSkills: [],
      },
    });
  }
}

export async function getAgentLogs(
  agentId: string,
  options: {
    limit?: number;
  } = {},
): Promise<AgentLogsResponse> {
  const limit = Math.max(20, Math.min(500, Math.floor(options.limit ?? 100)));

  try {
    return await apiGet(`/api/agents/${agentId}/logs?limit=${limit}`, AgentLogsResponseSchema);
  } catch {
    const attempts: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: 'agents.logs', params: { agentId, limit } },
      { method: 'agent.logs', params: { agentId, limit } },
      { method: 'logs.tail', params: { agentId, limit: Math.max(limit, 180) } },
      { method: 'logs.tail', params: { limit: Math.max(limit, 180) } },
    ];
    let fallbackError: unknown = null;

    for (const attempt of attempts) {
      try {
        const wsPayload = await requestGatewayWs(attempt.method, attempt.params);
        const wsRecord = isRecord(wsPayload) ? wsPayload : {};
        const rawLines =
          (Array.isArray(wsRecord.lines) ? wsRecord.lines : Array.isArray(wsRecord.logs) ? wsRecord.logs : [])
            .filter((line): line is string => typeof line === 'string')
            .map(normalizeWsLogLine);

        if (rawLines.length === 0) {
          continue;
        }

        const keyword = agentId.toLowerCase();
        const filtered = rawLines.filter((line) => line.toLowerCase().includes(keyword));
        const selected = (filtered.length > 0 ? filtered : rawLines).slice(-100);

        return AgentLogsResponseSchema.parse({
          agentId,
          logs: selected.slice(-limit),
          hasMore: selected.length >= limit,
        });
      } catch (error: unknown) {
        fallbackError = error;
      }
    }

    const message =
      fallbackError instanceof Error
        ? fallbackError.message
        : 'Unable to load logs from gateway';

    return AgentLogsResponseSchema.parse({
      agentId,
      logs: [`[log-unavailable] ${message}`],
      hasMore: false,
    });
  }
}

export async function restartAgent(agentId: string): Promise<ActionResponse> {
  return apiPost(`/api/agents/${agentId}/restart`, undefined, ActionResponseSchema, { skipRetry: true });
}

export async function toggleAgent(agentId: string, enabled: boolean): Promise<ActionResponse> {
  return apiPost(`/api/agents/${agentId}/${enabled ? 'enable' : 'disable'}`, undefined, ActionResponseSchema, {
    skipRetry: true,
  });
}

export async function killAgent(agentId: string): Promise<ActionResponse> {
  return apiPost(`/api/agents/${agentId}/kill`, undefined, ActionResponseSchema, { skipRetry: true });
}

export async function getSkills(): Promise<SkillsResponse> {
  try {
    return await apiGet('/api/skills', SkillsResponseSchema);
  } catch {
    const wsPayload = await requestGatewayWs('skills.status', {});
    const wsRecord = isRecord(wsPayload) ? wsPayload : {};
    const wsSkills = parseWsArray(wsRecord.skills ?? wsPayload);

    const skills = wsSkills.map((skill) => {
      const name = typeof skill.name === 'string' ? skill.name : 'unknown-skill';
      const source = typeof skill.source === 'string' ? skill.source : 'workspace';
      const version =
        typeof skill.version === 'string' && skill.version.trim()
          ? skill.version
          : source === 'openclaw-bundled'
            ? 'bundled'
            : 'workspace';

      return {
        name,
        version,
        description: typeof skill.description === 'string' ? skill.description : undefined,
        installedAt: toIsoDate(skill.installedAt),
        trusted: !toBoolean(skill.blockedByAllowlist),
      };
    });

    return SkillsResponseSchema.parse({ skills });
  }
}

export async function installSkill(payload: { name: string; version?: string }): Promise<ActionResponse> {
  return apiPost('/api/skills/install', payload, ActionResponseSchema, { skipRetry: true });
}

export async function uninstallSkill(name: string): Promise<ActionResponse> {
  return apiPost(`/api/skills/${encodeURIComponent(name)}/uninstall`, undefined, ActionResponseSchema, {
    skipRetry: true,
  });
}

export async function restartGateway(): Promise<ActionResponse> {
  return apiPost('/api/system/restart', undefined, ActionResponseSchema, { skipRetry: true });
}

export async function purgeSessions(): Promise<ActionResponse> {
  return apiPost('/api/sessions/purge', undefined, ActionResponseSchema, { skipRetry: true });
}

export async function getSessionLastHash(sessionId: string): Promise<SessionLastHashResponse> {
  try {
    return await apiGet(`/api/sessions/${sessionId}/last-hash`, SessionLastHashResponseSchema);
  } catch {
    const candidates = normalizeSessionIdCandidates(sessionId);
    for (const candidate of candidates) {
      const plans: Array<{ method: string; params: Record<string, unknown> }> = [
        { method: 'sessions.lastHash', params: { sessionId: candidate } },
        { method: 'session.lastHash', params: { sessionId: candidate } },
        { method: 'sessions.hash', params: { sessionId: candidate } },
      ];

      for (const plan of plans) {
        try {
          const payload = await requestGatewayWs(plan.method, plan.params);
          const record = isRecord(payload) ? payload : {};
          const hash = toNonEmptyString(record.hash) ?? toNonEmptyString(record.lastHash) ?? toNonEmptyString(record.id);
          if (hash) {
            return SessionLastHashResponseSchema.parse({
              sessionId,
              hash,
            });
          }
        } catch {
          // keep trying
        }
      }
    }

    const messages = await getSessionMessagesViaWs(sessionId);
    const last = messages.messages[messages.messages.length - 1];
    const fallbackHash = last ? `${last.id}:${last.createdAt}` : `${sessionId}:empty`;
    return SessionLastHashResponseSchema.parse({
      sessionId,
      hash: fallbackHash,
    });
  }
}

export async function getSessionMessages(sessionId: string, afterHash?: string): Promise<SessionMessagesResponse> {
  const query = afterHash ? `?afterHash=${encodeURIComponent(afterHash)}` : '';
  try {
    return await apiGet(`/api/sessions/${sessionId}/messages${query}`, SessionMessagesResponseSchema);
  } catch {
    try {
      return await getSessionMessagesViaWs(sessionId, afterHash);
    } catch {
      return SessionMessagesResponseSchema.parse({
        sessionId,
        messages: [],
      });
    }
  }
}

export async function getSessionsSummary(): Promise<SessionsSummaryResponse> {
  try {
    return await apiGet('/api/sessions', SessionsSummaryResponseSchema);
  } catch {
    try {
      return await apiGet('/api/sessions/list', SessionsSummaryResponseSchema);
    } catch {
      const wsSessions = await getSessionsListViaWs();

      const sessions = wsSessions.map((session) => {
        const sessionKey = typeof session.key === 'string' ? session.key : undefined;
        const sessionId = typeof session.sessionId === 'string' && session.sessionId ? session.sessionId : sessionKey;
        const displayName = typeof session.displayName === 'string' ? session.displayName : sessionKey;

        return {
          id: sessionId ?? sessionKey ?? `session-${Math.random().toString(16).slice(2)}`,
          title: displayName,
          agentId:
            (typeof session.agentId === 'string' && session.agentId) || extractAgentIdFromSessionKey(sessionKey),
          channelId: typeof session.channelId === 'string' ? session.channelId : undefined,
          model: typeof session.model === 'string' ? session.model : undefined,
          status: toBoolean(session.abortedLastRun) ? 'aborted' : undefined,
          updatedAt: toIsoDate(session.updatedAt),
          messageCount: Math.max(0, Math.floor(toNumber(session.messageCount) ?? 0)),
          contextTokens: Math.max(0, Math.floor(toNumber(session.contextTokens) ?? 0)),
          contextCount: Math.max(
            0,
            Math.floor(toNumber(session.contextCount) ?? toNumber(session.contextTokens) ?? 0),
          ),
        };
      });

      return SessionsSummaryResponseSchema.parse({ sessions });
    }
  }
}

export async function getChannels(): Promise<ChannelsResponse> {
  try {
    return await apiGet('/api/channels', ChannelsResponseSchema);
  } catch {
    try {
      return await apiGet('/api/channels/status', ChannelsResponseSchema);
    } catch {
      const wsPayload = await requestGatewayWs('channels.status', {});
      const wsRecord = isRecord(wsPayload) ? wsPayload : {};

      const order = Array.isArray(wsRecord.channelOrder)
        ? wsRecord.channelOrder.filter((item): item is string => typeof item === 'string')
        : [];
      const labels = isRecord(wsRecord.channelLabels) ? wsRecord.channelLabels : {};
      const channelStates = isRecord(wsRecord.channels) ? wsRecord.channels : {};
      const channelAccounts = isRecord(wsRecord.channelAccounts) ? wsRecord.channelAccounts : {};

      const channelIds = order.length > 0 ? order : Object.keys(channelStates);
      const channels = channelIds.map((channelId) => {
        const state = isRecord(channelStates[channelId]) ? channelStates[channelId] : {};
        const accounts = parseWsArray(channelAccounts[channelId]);
        const firstAccount = accounts[0] ?? {};

        const isRunning = toBoolean(state.running) || toBoolean(state.connected) || toBoolean(firstAccount.running);
        const isConfigured = toBoolean(state.configured) || toBoolean(firstAccount.configured);

        const status: 'healthy' | 'degraded' | 'offline' | 'unknown' = isRunning
          ? 'healthy'
          : isConfigured
            ? 'degraded'
            : 'offline';

        const lastEventAt =
          toIsoDate(firstAccount.lastInboundAt) ??
          toIsoDate(firstAccount.lastOutboundAt) ??
          toIsoDate(state.lastProbeAt) ??
          toIsoDate(state.lastConnectedAt);

        return {
          id: channelId,
          name: typeof labels[channelId] === 'string' ? String(labels[channelId]) : channelId,
          status,
          sessionCount: Math.max(0, Math.floor(toNumber(state.sessionCount) ?? 0)),
          lastEventAt,
          description: typeof state.lastError === 'string' ? state.lastError : undefined,
          metadata: {
            ...state,
            defaultAccount: firstAccount,
          },
        };
      });

      return ChannelsResponseSchema.parse({ channels });
    }
  }
}

export async function getUsageSummary(): Promise<UsageSummaryResponse> {
  try {
    return await apiGet('/api/usage', UsageSummaryResponseSchema);
  } catch {
    try {
      return await apiGet('/api/sessions/usage', UsageSummaryResponseSchema);
    } catch {
      const wsPayload = await requestGatewayWs('usage.status', {});
      const wsRecord = isRecord(wsPayload) ? wsPayload : {};
      const providersRaw = parseWsArray(wsRecord.providers ?? wsPayload);

      const providers = providersRaw.flatMap((provider) => {
        const providerId =
          (typeof provider.provider === 'string' && provider.provider) ||
          (typeof provider.id === 'string' && provider.id) ||
          'provider';
        const providerName =
          (typeof provider.displayName === 'string' && provider.displayName) ||
          (typeof provider.name === 'string' && provider.name) ||
          providerId;
        const plan = typeof provider.plan === 'string' ? provider.plan : undefined;

        const windows = Array.isArray(provider.windows) ? provider.windows.filter(isRecord) : [];
        if (windows.length === 0) {
          return [
            {
              id: providerId,
              name: providerName,
              plan,
            },
          ];
        }

        return windows.map((window, index) => {
          const usedPercent = Math.max(0, Math.min(100, Math.floor(toNumber(window.usedPercent) ?? 0)));
          return {
            id: `${providerId}:${typeof window.label === 'string' ? window.label : index}`,
            name: providerName,
            plan,
            period: typeof window.label === 'string' ? window.label : undefined,
            remainingPercent: Math.max(0, 100 - usedPercent),
            resetAt: toIsoDate(window.resetAt),
            used: usedPercent,
            limit: 100,
          };
        });
      });

      return UsageSummaryResponseSchema.parse({
        providers,
        fetchedAt: toIsoDate(wsRecord.updatedAt),
      });
    }
  }
}

export async function getModels(): Promise<ModelsResponse> {
  try {
    return await apiGet('/api/models', ModelsResponseSchema);
  } catch {
    try {
      return await apiGet('/api/models/list', ModelsResponseSchema);
    } catch {
      const wsPayload = await requestGatewayWs('models.list', {});
      const wsRecord = isRecord(wsPayload) ? wsPayload : {};
      const wsModels = parseWsArray(wsRecord.models ?? wsPayload);
      const seen = new Set<string>();

      const models = wsModels
        .map((model) => {
          const id = typeof model.id === 'string' ? model.id : undefined;
          if (!id || seen.has(id)) {
            return null;
          }
          seen.add(id);

          const supportsReasoning = toBoolean(model.reasoning) || /gpt-5|codex/i.test(id);
          const contextWindow =
            Math.max(
              0,
              Math.floor(
                toNumber(model.contextWindow) ??
                  toNumber(model.context_window) ??
                  toNumber(model.maxContextTokens) ??
                  toNumber(model.max_context_tokens) ??
                  toNumber(model.maxInputTokens) ??
                  toNumber(model.max_input_tokens) ??
                  0,
              ),
            ) || undefined;

          return {
            id,
            name: typeof model.name === 'string' ? model.name : id,
            provider: typeof model.provider === 'string' ? model.provider : undefined,
            supportsReasoning,
            reasoningOptions: supportsReasoning ? ['minimal', 'low', 'medium', 'high'] : [],
            contextWindow,
            maxContextTokens: contextWindow,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return ModelsResponseSchema.parse({ models });
    }
  }
}

export async function registerPushToken(input: {
  token: string;
  platform: 'ios' | 'android';
}): Promise<ActionResponse> {
  const token = input.token.trim();
  if (!token) {
    throw new Error('Push token is required');
  }

  return apiPost(
    '/api/devices/push-token',
    {
      token,
      platform: input.platform,
    },
    ActionResponseSchema,
  );
}
