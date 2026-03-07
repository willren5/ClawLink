import { z } from 'zod';

export const IsoDateStringSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

export const HealthStatusSchema = z.enum(['ok', 'degraded', 'error']);

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  uptimeSeconds: z.number().nonnegative(),
  version: z.string().min(1).optional(),
  timestamp: IsoDateStringSchema.optional(),
});

export const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(['online', 'offline', 'unknown']).default('unknown'),
  lastSeenAt: IsoDateStringSchema.optional(),
});

export const DevicesResponseSchema = z.object({
  devices: z.array(DeviceSchema),
});

export const TrendSchema = z.object({
  direction: z.enum(['up', 'down', 'flat']),
  percentage: z.number(),
});

export const RequestVolumePointSchema = z.object({
  timestamp: IsoDateStringSchema,
  count: z.number().int().nonnegative(),
});

export const RequestsStatsResponseSchema = z.object({
  period: z.string().min(1),
  total: z.number().int().nonnegative(),
  trend: TrendSchema,
  points: z.array(RequestVolumePointSchema),
});

export const TokenByModelSchema = z.object({
  model: z.string().min(1),
  tokens: z.number().int().nonnegative(),
});

export const TokenStatsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  byModel: z.array(TokenByModelSchema),
});

export const LatencyStatsResponseSchema = z.object({
  unit: z.literal('ms'),
  p50: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
});

export const AgentStatusSchema = z.enum(['active', 'idle', 'error', 'disabled']);

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1).optional(),
  status: AgentStatusSchema,
  lastActiveAt: IsoDateStringSchema.optional(),
  conversationCount: z.number().int().nonnegative().optional(),
});

export const AgentsResponseSchema = z.object({
  agents: z.array(AgentSchema),
});

export const AgentDetailResponseSchema = z.object({
  agent: AgentSchema.extend({
    config: z.record(z.string(), z.unknown()),
    assignedSkills: z.array(z.string()),
  }),
});

export const AgentLogsResponseSchema = z.object({
  agentId: z.string().min(1),
  logs: z.array(z.string()),
  hasMore: z.boolean().optional(),
});

export const AgentLogStreamEventSchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).catch('INFO'),
  message: z.string().min(1),
  timestamp: IsoDateStringSchema.optional(),
});

export const SkillSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  installedAt: IsoDateStringSchema.optional(),
  trusted: z.boolean().optional(),
});

export const SkillsResponseSchema = z.object({
  skills: z.array(SkillSchema),
});

export const InstallSkillRequestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1).optional(),
});

export const ActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export const SystemMetricsSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memPercent: z.number().min(0).max(100),
  diskIo: z.number().nonnegative().optional(),
  gpuTemp: z.number().nonnegative().optional(),
  netUp: z.number().nonnegative().optional(),
  netDown: z.number().nonnegative().optional(),
  timestamp: IsoDateStringSchema.optional(),
});

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: IsoDateStringSchema,
  model: z.string().optional(),
});

export const SessionSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: IsoDateStringSchema,
  messageCount: z.number().int().nonnegative(),
});

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});

export const ChannelStatusSchema = z.enum(['healthy', 'degraded', 'offline', 'unknown']).catch('unknown');

export const ChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  status: ChannelStatusSchema.optional(),
  sessionCount: z.number().int().nonnegative().optional(),
  lastEventAt: IsoDateStringSchema.optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ChannelsResponseSchema = z
  .union([z.object({ channels: z.array(ChannelSchema) }), z.array(ChannelSchema)])
  .transform((value) => ({
    channels: Array.isArray(value) ? value : value.channels,
  }));

export const SessionSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  agentId: z.string().optional(),
  channelId: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional(),
  updatedAt: IsoDateStringSchema.optional(),
  messageCount: z.number().int().nonnegative().optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  contextCount: z.number().int().nonnegative().optional(),
});

export const SessionsSummaryResponseSchema = z
  .union([z.object({ sessions: z.array(SessionSummarySchema) }), z.array(SessionSummarySchema)])
  .transform((value) => ({
    sessions: Array.isArray(value) ? value : value.sessions,
  }));

export const UsageProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  plan: z.string().optional(),
  period: z.string().optional(),
  remainingPercent: z.number().min(0).max(100).optional(),
  resetAt: IsoDateStringSchema.optional(),
  limit: z.number().nonnegative().optional(),
  used: z.number().nonnegative().optional(),
});

export const UsageSummaryResponseSchema = z
  .union([
    z.object({
      providers: z.array(UsageProviderSchema),
      fetchedAt: IsoDateStringSchema.optional(),
    }),
    z.object({
      usage: z.object({ providers: z.array(UsageProviderSchema) }),
      fetchedAt: IsoDateStringSchema.optional(),
    }),
    z.array(UsageProviderSchema),
  ])
  .transform((value) => {
    if (Array.isArray(value)) {
      return { providers: value };
    }
    if ('providers' in value) {
      return { providers: value.providers, fetchedAt: value.fetchedAt };
    }
    return { providers: value.usage.providers, fetchedAt: value.fetchedAt };
  });

export const ModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  provider: z.string().optional(),
  supportsReasoning: z.boolean().optional(),
  reasoningOptions: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
});

export const ModelsResponseSchema = z
  .union([z.object({ models: z.array(ModelSchema) }), z.array(ModelSchema)])
  .transform((value) => ({
    models: Array.isArray(value) ? value : value.models,
  }));

export const CreateAgentRequestSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
});

export const CreateAgentResponseSchema = z.object({
  success: z.boolean().default(true),
  message: z.string().optional(),
  agent: z.record(z.string(), z.unknown()).optional(),
});

export const SessionLastHashResponseSchema = z.object({
  sessionId: z.string().min(1),
  hash: z.string().min(1),
});

export const SessionMessagesResponseSchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(ChatMessageSchema),
});

export const DashboardSnapshotResponseSchema = z.object({
  gateway: z.object({
    status: z.enum(['online', 'offline']),
    uptimeSeconds: z.number().int().nonnegative(),
  }),
  requestsToday: z.object({
    total: z.number().int().nonnegative(),
    trend: TrendSchema,
  }),
  tokenUsageToday: z.number().int().nonnegative(),
  estimatedCostToday: z.number().nonnegative(),
  requestVolume24h: z.array(RequestVolumePointSchema),
  tokenUsageByModel: z.array(TokenByModelSchema),
  latency: LatencyStatsResponseSchema,
  fetchedAt: IsoDateStringSchema,
});

export const ApiErrorResponseSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
  statusCode: z.number().int().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;
export type RequestsStatsResponse = z.infer<typeof RequestsStatsResponseSchema>;
export type TokenStatsResponse = z.infer<typeof TokenStatsResponseSchema>;
export type LatencyStatsResponse = z.infer<typeof LatencyStatsResponseSchema>;
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;
export type AgentLogsResponse = z.infer<typeof AgentLogsResponseSchema>;
export type AgentLogStreamEvent = z.infer<typeof AgentLogStreamEventSchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
export type ActionResponse = z.infer<typeof ActionResponseSchema>;
export type SystemMetrics = z.infer<typeof SystemMetricsSchema>;
export type DashboardSnapshotResponse = z.infer<typeof DashboardSnapshotResponseSchema>;
export type SessionLastHashResponse = z.infer<typeof SessionLastHashResponseSchema>;
export type SessionMessagesResponse = z.infer<typeof SessionMessagesResponseSchema>;
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;
export type SessionsSummaryResponse = z.infer<typeof SessionsSummaryResponseSchema>;
export type UsageSummaryResponse = z.infer<typeof UsageSummaryResponseSchema>;
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type CreateAgentResponse = z.infer<typeof CreateAgentResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
