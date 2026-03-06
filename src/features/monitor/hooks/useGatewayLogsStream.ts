import { useCallback, useEffect, useRef, useState } from 'react';

import { requestGatewayWs } from '../../../lib/api/gatewayWs';
import { appendManyWithLimit } from '../../../lib/utils/ringBuffer';
import { useConnectionStore } from '../../connection/store/connectionStore';
import type { GatewayLogEntry, LogLevel } from '../types';

const MAX_LOG_COUNT = 400;
const LOG_BATCH_FLUSH_MS = 120;
const LOG_POLL_INTERVAL_MS = 1800;

interface UseGatewayLogsStreamResult {
  connected: boolean;
  paused: boolean;
  logs: GatewayLogEntry[];
  togglePaused: () => void;
  clearLogs: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLevel(input: unknown): LogLevel {
  const level = typeof input === 'string' ? input.toUpperCase() : '';
  if (level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
    return level;
  }
  return 'INFO';
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function normalizeLogMessage(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  const parts: string[] = [];
  for (const key of ['0', '1', '2', '3']) {
    const value = payload[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string') {
      parts.push(value);
    } else {
      try {
        parts.push(JSON.stringify(value));
      } catch {
        parts.push(String(value));
      }
    }
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return fallback;
}

function parseTailLogLine(line: string): Omit<GatewayLogEntry, 'id'> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      return {
        level: 'INFO',
        message: line,
        timestamp: Date.now(),
      };
    }

    const meta = isRecord(parsed._meta) ? parsed._meta : null;
    const level = normalizeLevel(parsed.level ?? meta?.logLevelName);
    const timestamp = normalizeTimestamp(parsed.timestamp ?? parsed.time ?? meta?.date);

    return {
      level,
      message: normalizeLogMessage(parsed, line),
      timestamp,
    };
  } catch {
    return {
      level: 'INFO',
      message: line,
      timestamp: Date.now(),
    };
  }
}

export function useGatewayLogsStream(enabled = true): UseGatewayLogsStreamResult {
  const hasActiveProfile = useConnectionStore((state) =>
    state.activeProfileId ? state.profiles.some((profile) => profile.id === state.activeProfileId) : false,
  );
  const [logs, setLogs] = useState<GatewayLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);

  const pausedRef = useRef(paused);
  const pendingLogsRef = useRef<Array<Omit<GatewayLogEntry, 'id'>>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorRef = useRef<number | null>(null);

  pausedRef.current = paused;

  const flushPendingLogs = useCallback(() => {
    const buffered = pendingLogsRef.current;
    pendingLogsRef.current = [];

    if (!buffered.length || pausedRef.current) {
      return;
    }

    const stamped = buffered.map((entry, index) => ({
      ...entry,
      id: `${entry.timestamp}:${index}:${Math.random().toString(16).slice(2)}`,
    }));

    setLogs((prev) => appendManyWithLimit(prev, stamped, MAX_LOG_COUNT));
  }, []);

  const queueLog = useCallback(
    (entry: Omit<GatewayLogEntry, 'id'>) => {
      if (pausedRef.current) {
        return;
      }

      pendingLogsRef.current.push(entry);
      if (flushTimerRef.current) {
        return;
      }

      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingLogs();
      }, LOG_BATCH_FLUSH_MS);
    },
    [flushPendingLogs],
  );

  useEffect(() => {
    if (!enabled || !hasActiveProfile) {
      setConnected(false);
      return;
    }

    let canceled = false;
    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (canceled || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const payload = await requestGatewayWs('logs.tail', {
          limit: 80,
          ...(typeof cursorRef.current === 'number' ? { cursor: cursorRef.current } : {}),
        });

        if (canceled) {
          return;
        }

        const record = isRecord(payload) ? payload : {};
        const cursorValue = record.cursor;
        if (typeof cursorValue === 'number' && Number.isFinite(cursorValue)) {
          cursorRef.current = cursorValue;
        }

        if (record.reset === true) {
          cursorRef.current = null;
        }

        const lines = Array.isArray(record.lines)
          ? record.lines.filter((line): line is string => typeof line === 'string')
          : [];

        for (const line of lines) {
          queueLog(parseTailLogLine(line));
        }

        setConnected(true);
      } catch {
        if (!canceled) {
          setConnected(false);
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, LOG_POLL_INTERVAL_MS);

    return () => {
      canceled = true;
      clearInterval(timer);
      setConnected(false);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingLogsRef.current = [];
    };
  }, [enabled, hasActiveProfile, queueLog]);

  return {
    connected,
    paused,
    logs,
    togglePaused: () => {
      setPaused((prev) => !prev);
    },
    clearLogs: () => {
      pendingLogsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setLogs([]);
    },
  };
}
