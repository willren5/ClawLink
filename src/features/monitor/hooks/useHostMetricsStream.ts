import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { requestGatewayWs } from '../../../lib/api/gatewayWs';
import { appendWithLimit } from '../../../lib/utils/ringBuffer';
import { useConnectionStore } from '../../connection/store/connectionStore';
import type { HostMetrics } from '../types';

const MAX_METRIC_POINTS = 60;
const METRIC_FLUSH_INTERVAL_MS = 1000;
const GATEWAY_POLL_INTERVAL_MS = 3000;

type MetricsSource = 'probe' | 'gateway' | 'none';

interface GatewayTelemetrySnapshot {
  timestamp: number;
  latencyMs: number;
  runningChannels: number;
  configuredChannels: number;
  sessionsCount: number;
}

interface UseHostMetricsStreamResult {
  connected: boolean;
  unsupported: boolean;
  source: MetricsSource;
  latest: HostMetrics | null;
  cpuHistory: number[];
  memHistory: number[];
  netHistory: Array<{ up: number; down: number }>;
  gatewayTelemetry: GatewayTelemetrySnapshot | null;
  gatewayLatencyHistory: number[];
  gatewayChannelHistory: number[];
}

interface MetricsSeriesState {
  latest: HostMetrics | null;
  cpuHistory: number[];
  memHistory: number[];
  netHistory: Array<{ up: number; down: number }>;
  gatewayTelemetry: GatewayTelemetrySnapshot | null;
  gatewayLatencyHistory: number[];
  gatewayChannelHistory: number[];
}

const INITIAL_SERIES_STATE: MetricsSeriesState = {
  latest: null,
  cpuHistory: [],
  memHistory: [],
  netHistory: [],
  gatewayTelemetry: null,
  gatewayLatencyHistory: [],
  gatewayChannelHistory: [],
};

function toWebSocketUrl(host: string, port: number, tls: boolean): string {
  const protocol = tls ? 'wss' : 'ws';
  return `${protocol}://${host}:${port}/metrics/stream`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function toTimestamp(value: unknown): number {
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function parseMetricsPayload(raw: string): HostMetrics | null {
  try {
    const parsed = JSON.parse(raw) as Partial<{
      cpu_percent: number;
      cpuPercent: number;
      mem_percent: number;
      memPercent: number;
      disk_io: number;
      diskIo: number;
      gpu_temp: number;
      gpuTemp: number;
      net_io: { up: number; down: number };
      netIo: { up: number; down: number };
      timestamp: string;
    }>;

    const cpu = parsed.cpu_percent ?? parsed.cpuPercent;
    const mem = parsed.mem_percent ?? parsed.memPercent;

    if (typeof cpu !== 'number' || typeof mem !== 'number') {
      return null;
    }

    return {
      timestamp: parsed.timestamp ? Date.parse(parsed.timestamp) || Date.now() : Date.now(),
      cpuPercent: clampPercent(cpu),
      memPercent: clampPercent(mem),
      diskIo:
        typeof parsed.disk_io === 'number'
          ? parsed.disk_io
          : typeof parsed.diskIo === 'number'
            ? parsed.diskIo
            : undefined,
      gpuTemp:
        typeof parsed.gpu_temp === 'number'
          ? parsed.gpu_temp
          : typeof parsed.gpuTemp === 'number'
            ? parsed.gpuTemp
            : undefined,
      netUp: parsed.net_io?.up ?? parsed.netIo?.up,
      netDown: parsed.net_io?.down ?? parsed.netIo?.down,
    };
  } catch {
    return null;
  }
}

function parseGatewayTelemetry(payload: unknown): GatewayTelemetrySnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }

  const channelsNode = isRecord(payload.channels) ? payload.channels : {};
  let runningChannels = 0;
  let configuredChannels = 0;

  for (const channelState of Object.values(channelsNode)) {
    if (!isRecord(channelState)) {
      continue;
    }

    const accounts = isRecord(channelState.accounts) ? channelState.accounts : {};
    const accountStates = Object.values(accounts).filter(isRecord);

    const runningFromState = toBoolean(channelState.running) || toBoolean(channelState.connected);
    const configuredFromState = toBoolean(channelState.configured);

    const runningFromAccounts = accountStates.some((entry) => toBoolean(entry.running) || toBoolean(entry.connected));
    const configuredFromAccounts = accountStates.some((entry) => toBoolean(entry.configured));

    if (runningFromState || runningFromAccounts) {
      runningChannels += 1;
    }

    if (configuredFromState || configuredFromAccounts) {
      configuredChannels += 1;
    }
  }

  const sessionsNode = isRecord(payload.sessions) ? payload.sessions : null;

  return {
    timestamp: toTimestamp(payload.ts),
    latencyMs: Math.max(0, Math.floor(toNumber(payload.durationMs) ?? 0)),
    runningChannels,
    configuredChannels,
    sessionsCount: Math.max(0, Math.floor(toNumber(sessionsNode?.count) ?? 0)),
  };
}

export function useHostMetricsStream(probePort: number, enabled = true): UseHostMetricsStreamResult {
  const profile = useConnectionStore((state) =>
    state.activeProfileId ? state.profiles.find((item) => item.id === state.activeProfileId) ?? null : null,
  );
  const [connected, setConnected] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [source, setSource] = useState<MetricsSource>('none');
  const [seriesState, setSeriesState] = useState<MetricsSeriesState>(INITIAL_SERIES_STATE);
  const pendingMetricsRef = useRef<HostMetrics | null>(null);

  const wsUrl = useMemo(() => {
    if (!profile) {
      return null;
    }

    return toWebSocketUrl(profile.host, probePort, profile.tls);
  }, [probePort, profile]);

  const flushPendingMetric = useCallback(() => {
    const pending = pendingMetricsRef.current;
    if (!pending) {
      return;
    }

    pendingMetricsRef.current = null;

    setSeriesState((prev) => ({
      ...prev,
      latest: pending,
      cpuHistory: appendWithLimit(prev.cpuHistory, pending.cpuPercent, MAX_METRIC_POINTS),
      memHistory: appendWithLimit(prev.memHistory, pending.memPercent, MAX_METRIC_POINTS),
      netHistory: appendWithLimit(
        prev.netHistory,
        {
          up: pending.netUp ?? 0,
          down: pending.netDown ?? 0,
        },
        MAX_METRIC_POINTS,
      ),
    }));
  }, []);

  useEffect(() => {
    pendingMetricsRef.current = null;

    if (!enabled || !wsUrl) {
      setConnected(false);
      setUnsupported(false);
      setSource('none');
      setSeriesState(INITIAL_SERIES_STATE);
      return;
    }

    let canceled = false;
    let probeConnected = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let pollingFallback = false;

    const flushTimer = setInterval(() => {
      flushPendingMetric();
    }, METRIC_FLUSH_INTERVAL_MS);

    const pushGatewayTelemetry = (snapshot: GatewayTelemetrySnapshot): void => {
      setSeriesState((prev) => ({
        ...prev,
        gatewayTelemetry: snapshot,
        gatewayLatencyHistory: appendWithLimit(prev.gatewayLatencyHistory, snapshot.latencyMs, MAX_METRIC_POINTS),
        gatewayChannelHistory: appendWithLimit(prev.gatewayChannelHistory, snapshot.runningChannels, MAX_METRIC_POINTS),
      }));
    };

    const stopFallback = (): void => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      pollingFallback = false;
    };

    const pollGatewayTelemetry = async (): Promise<void> => {
      if (canceled || pollingFallback) {
        return;
      }

      pollingFallback = true;
      try {
        const payload = await requestGatewayWs('health', {});
        if (canceled) {
          return;
        }

        const telemetry = parseGatewayTelemetry(payload);
        if (!telemetry) {
          setConnected(false);
          setUnsupported(true);
          if (!probeConnected) {
            setSource('none');
          }
          return;
        }

        setConnected(true);
        setUnsupported(false);
        if (!probeConnected) {
          setSource('gateway');
        }
        pushGatewayTelemetry(telemetry);
      } catch {
        if (!canceled && !probeConnected) {
          setConnected(false);
          setUnsupported(true);
          setSource('none');
        }
      } finally {
        pollingFallback = false;
      }
    };

    const startFallback = (): void => {
      if (fallbackTimer || canceled) {
        return;
      }

      void pollGatewayTelemetry();
      fallbackTimer = setInterval(() => {
        void pollGatewayTelemetry();
      }, GATEWAY_POLL_INTERVAL_MS);
    };

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      probeConnected = true;
      stopFallback();
      setConnected(true);
      setUnsupported(false);
      setSource('probe');
    };

    ws.onerror = () => {
      setConnected(false);
      if (!probeConnected) {
        startFallback();
      }
    };

    ws.onclose = () => {
      probeConnected = false;
      setConnected(false);
      startFallback();
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      const parsed = parseMetricsPayload(event.data);
      if (!parsed) {
        return;
      }

      probeConnected = true;
      stopFallback();
      setConnected(true);
      setUnsupported(false);
      setSource('probe');
      pendingMetricsRef.current = parsed;
    };

    return () => {
      canceled = true;
      stopFallback();
      clearInterval(flushTimer);
      pendingMetricsRef.current = null;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      setConnected(false);
    };
  }, [enabled, flushPendingMetric, wsUrl]);

  return {
    connected,
    unsupported,
    source,
    latest: seriesState.latest,
    cpuHistory: seriesState.cpuHistory,
    memHistory: seriesState.memHistory,
    netHistory: seriesState.netHistory,
    gatewayTelemetry: seriesState.gatewayTelemetry,
    gatewayLatencyHistory: seriesState.gatewayLatencyHistory,
    gatewayChannelHistory: seriesState.gatewayChannelHistory,
  };
}
