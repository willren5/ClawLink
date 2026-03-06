export function buildGatewayBaseUrl(host: string, port: number, tls: boolean): string {
  const protocol = tls ? 'https' : 'http';
  return `${protocol}://${host.trim()}:${port}`;
}

export interface ParsedGatewayEndpointInput {
  host: string;
  port?: number;
  tls?: boolean;
}

function parseValidPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }

  return parsed;
}

export function parseGatewayEndpointInput(value: string): ParsedGatewayEndpointInput {
  const raw = value.trim();
  if (!raw) {
    return { host: '' };
  }

  const hasProtocol = /^https?:\/\//i.test(raw);
  const candidate = hasProtocol ? raw : `http://${raw}`;

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.trim();
    if (!host) {
      return { host: '' };
    }

    const resolved: ParsedGatewayEndpointInput = {
      host,
      port: parseValidPort(parsed.port),
    };

    if (hasProtocol) {
      resolved.tls = parsed.protocol === 'https:';
    }

    return resolved;
  } catch {
    return { host: raw.replace(/\/.*$/, '').replace(/:\d+$/, '').trim() };
  }
}

export function normalizeHost(host: string): string {
  return parseGatewayEndpointInput(host).host;
}

export function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('端口必须在 1 到 65535 之间');
  }
  return parsed;
}
