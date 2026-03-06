export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface GatewayLogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface HostMetrics {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  diskIo?: number;
  gpuTemp?: number;
  netUp?: number;
  netDown?: number;
}
