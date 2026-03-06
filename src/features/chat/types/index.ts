export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export type SyncStatus = 'synced' | 'pending' | 'failed' | 'streaming';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type ToolTimelineStepKind = 'tool' | 'reasoning' | 'io' | 'response';

export interface ToolTimelineStep {
  id: string;
  kind: ToolTimelineStepKind;
  label: string;
  startedAt: number;
  durationMs: number;
  status: 'running' | 'completed';
}

export interface ChatMessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextTokens?: number;
  contextLimit?: number;
}

export interface ChatImageAttachment {
  type: 'image';
  mimeType: string;
  base64: string;
  fileName?: string;
  width?: number;
  height?: number;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatAttachmentPreview {
  type: 'image';
  mimeType: string;
  previewUri?: string;
  width?: number;
  height?: number;
}

export interface LocalChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  hash: string;
  syncStatus: SyncStatus;
  agentId?: string;
  attachments?: ChatAttachmentPreview[];
  toolTimeline?: ToolTimelineStep[];
  usage?: ChatMessageUsage;
}

export interface LocalChatSession {
  id: string;
  agentId?: string;
  title: string;
  updatedAt: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  totalTokens: number;
  estimatedCost: number;
  contextCount: number;
  contextLimit?: number;
  lastUsageAt?: number;
}

export interface PendingOutboundMessage {
  messageId: string;
  sessionId: string;
  agentId?: string;
  content: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  createdAt: number;
  attachments?: ChatAttachment[];
}
