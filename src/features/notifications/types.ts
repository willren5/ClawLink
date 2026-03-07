export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertType =
  | 'agent_error'
  | 'disconnect_timeout'
  | 'queue_backlog'
  | 'error_count_transition'
  | 'budget_near_limit'
  | 'budget_exceeded';

export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type AlertQuickActionId =
  | 'reconnect_gateway'
  | 'open_monitor'
  | 'flush_queue'
  | 'open_chat'
  | 'refresh_agents'
  | 'open_agents'
  | 'open_dashboard';
