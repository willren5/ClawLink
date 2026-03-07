"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiErrorResponseSchema = exports.DashboardSnapshotResponseSchema = exports.SessionMessagesResponseSchema = exports.SessionLastHashResponseSchema = exports.CreateAgentResponseSchema = exports.CreateAgentRequestSchema = exports.ModelsResponseSchema = exports.ModelSchema = exports.UsageSummaryResponseSchema = exports.UsageProviderSchema = exports.SessionsSummaryResponseSchema = exports.SessionSummarySchema = exports.ChannelsResponseSchema = exports.ChannelSchema = exports.ChannelStatusSchema = exports.SessionsResponseSchema = exports.SessionSchema = exports.ChatMessageSchema = exports.ChatRoleSchema = exports.SystemMetricsSchema = exports.ActionResponseSchema = exports.InstallSkillRequestSchema = exports.SkillsResponseSchema = exports.SkillSchema = exports.AgentLogStreamEventSchema = exports.AgentLogsResponseSchema = exports.AgentDetailResponseSchema = exports.AgentsResponseSchema = exports.AgentSchema = exports.AgentStatusSchema = exports.LatencyStatsResponseSchema = exports.TokenStatsResponseSchema = exports.TokenByModelSchema = exports.RequestsStatsResponseSchema = exports.RequestVolumePointSchema = exports.TrendSchema = exports.DevicesResponseSchema = exports.DeviceSchema = exports.HealthResponseSchema = exports.HealthStatusSchema = exports.IsoDateStringSchema = void 0;
const zod_1 = require("zod");
exports.IsoDateStringSchema = zod_1.z.string().datetime({ offset: true }).or(zod_1.z.string().datetime());
exports.HealthStatusSchema = zod_1.z.enum(['ok', 'degraded', 'error']);
exports.HealthResponseSchema = zod_1.z.object({
    status: exports.HealthStatusSchema,
    uptimeSeconds: zod_1.z.number().nonnegative(),
    version: zod_1.z.string().min(1).optional(),
    timestamp: exports.IsoDateStringSchema.optional(),
});
exports.DeviceSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    type: zod_1.z.string().min(1),
    status: zod_1.z.enum(['online', 'offline', 'unknown']).default('unknown'),
    lastSeenAt: exports.IsoDateStringSchema.optional(),
});
exports.DevicesResponseSchema = zod_1.z.object({
    devices: zod_1.z.array(exports.DeviceSchema),
});
exports.TrendSchema = zod_1.z.object({
    direction: zod_1.z.enum(['up', 'down', 'flat']),
    percentage: zod_1.z.number(),
});
exports.RequestVolumePointSchema = zod_1.z.object({
    timestamp: exports.IsoDateStringSchema,
    count: zod_1.z.number().int().nonnegative(),
});
exports.RequestsStatsResponseSchema = zod_1.z.object({
    period: zod_1.z.string().min(1),
    total: zod_1.z.number().int().nonnegative(),
    trend: exports.TrendSchema,
    points: zod_1.z.array(exports.RequestVolumePointSchema),
});
exports.TokenByModelSchema = zod_1.z.object({
    model: zod_1.z.string().min(1),
    tokens: zod_1.z.number().int().nonnegative(),
});
exports.TokenStatsResponseSchema = zod_1.z.object({
    total: zod_1.z.number().int().nonnegative(),
    byModel: zod_1.z.array(exports.TokenByModelSchema),
});
exports.LatencyStatsResponseSchema = zod_1.z.object({
    unit: zod_1.z.literal('ms'),
    p50: zod_1.z.number().nonnegative(),
    p95: zod_1.z.number().nonnegative(),
    p99: zod_1.z.number().nonnegative(),
});
exports.AgentStatusSchema = zod_1.z.enum(['active', 'idle', 'error', 'disabled']);
exports.AgentSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    model: zod_1.z.string().min(1).optional(),
    status: exports.AgentStatusSchema,
    lastActiveAt: exports.IsoDateStringSchema.optional(),
    conversationCount: zod_1.z.number().int().nonnegative().optional(),
});
exports.AgentsResponseSchema = zod_1.z.object({
    agents: zod_1.z.array(exports.AgentSchema),
});
exports.AgentDetailResponseSchema = zod_1.z.object({
    agent: exports.AgentSchema.extend({
        config: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
        assignedSkills: zod_1.z.array(zod_1.z.string()),
    }),
});
exports.AgentLogsResponseSchema = zod_1.z.object({
    agentId: zod_1.z.string().min(1),
    logs: zod_1.z.array(zod_1.z.string()),
    hasMore: zod_1.z.boolean().optional(),
});
exports.AgentLogStreamEventSchema = zod_1.z.object({
    level: zod_1.z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).catch('INFO'),
    message: zod_1.z.string().min(1),
    timestamp: exports.IsoDateStringSchema.optional(),
});
exports.SkillSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    version: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    installedAt: exports.IsoDateStringSchema.optional(),
    trusted: zod_1.z.boolean().optional(),
});
exports.SkillsResponseSchema = zod_1.z.object({
    skills: zod_1.z.array(exports.SkillSchema),
});
exports.InstallSkillRequestSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    version: zod_1.z.string().min(1).optional(),
});
exports.ActionResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string().optional(),
});
exports.SystemMetricsSchema = zod_1.z.object({
    cpuPercent: zod_1.z.number().min(0).max(100),
    memPercent: zod_1.z.number().min(0).max(100),
    diskIo: zod_1.z.number().nonnegative().optional(),
    gpuTemp: zod_1.z.number().nonnegative().optional(),
    netUp: zod_1.z.number().nonnegative().optional(),
    netDown: zod_1.z.number().nonnegative().optional(),
    timestamp: exports.IsoDateStringSchema.optional(),
});
exports.ChatRoleSchema = zod_1.z.enum(['system', 'user', 'assistant', 'tool']);
exports.ChatMessageSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    sessionId: zod_1.z.string().min(1),
    role: exports.ChatRoleSchema,
    content: zod_1.z.string(),
    createdAt: exports.IsoDateStringSchema,
    model: zod_1.z.string().optional(),
});
exports.SessionSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    agentId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    updatedAt: exports.IsoDateStringSchema,
    messageCount: zod_1.z.number().int().nonnegative(),
});
exports.SessionsResponseSchema = zod_1.z.object({
    sessions: zod_1.z.array(exports.SessionSchema),
});
exports.ChannelStatusSchema = zod_1.z.enum(['healthy', 'degraded', 'offline', 'unknown']).catch('unknown');
exports.ChannelSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().optional(),
    status: exports.ChannelStatusSchema.optional(),
    sessionCount: zod_1.z.number().int().nonnegative().optional(),
    lastEventAt: exports.IsoDateStringSchema.optional(),
    description: zod_1.z.string().optional(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
exports.ChannelsResponseSchema = zod_1.z
    .union([zod_1.z.object({ channels: zod_1.z.array(exports.ChannelSchema) }), zod_1.z.array(exports.ChannelSchema)])
    .transform((value) => ({
    channels: Array.isArray(value) ? value : value.channels,
}));
exports.SessionSummarySchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    title: zod_1.z.string().optional(),
    agentId: zod_1.z.string().optional(),
    channelId: zod_1.z.string().optional(),
    model: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    updatedAt: exports.IsoDateStringSchema.optional(),
    messageCount: zod_1.z.number().int().nonnegative().optional(),
    contextTokens: zod_1.z.number().int().nonnegative().optional(),
    contextCount: zod_1.z.number().int().nonnegative().optional(),
});
exports.SessionsSummaryResponseSchema = zod_1.z
    .union([zod_1.z.object({ sessions: zod_1.z.array(exports.SessionSummarySchema) }), zod_1.z.array(exports.SessionSummarySchema)])
    .transform((value) => ({
    sessions: Array.isArray(value) ? value : value.sessions,
}));
exports.UsageProviderSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().optional(),
    plan: zod_1.z.string().optional(),
    period: zod_1.z.string().optional(),
    remainingPercent: zod_1.z.number().min(0).max(100).optional(),
    resetAt: exports.IsoDateStringSchema.optional(),
    limit: zod_1.z.number().nonnegative().optional(),
    used: zod_1.z.number().nonnegative().optional(),
});
exports.UsageSummaryResponseSchema = zod_1.z
    .union([
    zod_1.z.object({
        providers: zod_1.z.array(exports.UsageProviderSchema),
        fetchedAt: exports.IsoDateStringSchema.optional(),
    }),
    zod_1.z.object({
        usage: zod_1.z.object({ providers: zod_1.z.array(exports.UsageProviderSchema) }),
        fetchedAt: exports.IsoDateStringSchema.optional(),
    }),
    zod_1.z.array(exports.UsageProviderSchema),
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
exports.ModelSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().optional(),
    provider: zod_1.z.string().optional(),
    supportsReasoning: zod_1.z.boolean().optional(),
    reasoningOptions: zod_1.z.array(zod_1.z.string()).optional(),
    contextWindow: zod_1.z.number().int().positive().optional(),
    maxContextTokens: zod_1.z.number().int().positive().optional(),
});
exports.ModelsResponseSchema = zod_1.z
    .union([zod_1.z.object({ models: zod_1.z.array(exports.ModelSchema) }), zod_1.z.array(exports.ModelSchema)])
    .transform((value) => ({
    models: Array.isArray(value) ? value : value.models,
}));
exports.CreateAgentRequestSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    model: zod_1.z.string().min(1).optional(),
    systemPrompt: zod_1.z.string().optional(),
});
exports.CreateAgentResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean().default(true),
    message: zod_1.z.string().optional(),
    agent: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
exports.SessionLastHashResponseSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    hash: zod_1.z.string().min(1),
});
exports.SessionMessagesResponseSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    messages: zod_1.z.array(exports.ChatMessageSchema),
});
exports.DashboardSnapshotResponseSchema = zod_1.z.object({
    gateway: zod_1.z.object({
        status: zod_1.z.enum(['online', 'offline']),
        uptimeSeconds: zod_1.z.number().int().nonnegative(),
    }),
    requestsToday: zod_1.z.object({
        total: zod_1.z.number().int().nonnegative(),
        trend: exports.TrendSchema,
    }),
    tokenUsageToday: zod_1.z.number().int().nonnegative(),
    estimatedCostToday: zod_1.z.number().nonnegative(),
    requestVolume24h: zod_1.z.array(exports.RequestVolumePointSchema),
    tokenUsageByModel: zod_1.z.array(exports.TokenByModelSchema),
    latency: exports.LatencyStatsResponseSchema,
    fetchedAt: exports.IsoDateStringSchema,
});
exports.ApiErrorResponseSchema = zod_1.z.object({
    error: zod_1.z.string().min(1),
    message: zod_1.z.string().min(1),
    statusCode: zod_1.z.number().int().optional(),
});
