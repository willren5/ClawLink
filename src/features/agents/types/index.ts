export type AgentUiStatus = 'active' | 'idle' | 'error' | 'disabled';

export interface AgentListItem {
  id: string;
  name: string;
  status: AgentUiStatus;
  lastActiveAt?: string;
  conversationCount?: number;
  model?: string;
}
