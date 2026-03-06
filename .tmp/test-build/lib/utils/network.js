"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGatewayBaseUrl = buildGatewayBaseUrl;
exports.parseGatewayEndpointInput = parseGatewayEndpointInput;
exports.normalizeHost = normalizeHost;
exports.parsePort = parsePort;
function buildGatewayBaseUrl(host, port, tls) {
    const protocol = tls ? 'https' : 'http';
    return `${protocol}://${host.trim()}:${port}`;
}
function parseValidPort(value) {
    if (!value) {
        return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return undefined;
    }
    return parsed;
}
function parseGatewayEndpointInput(value) {
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
        const resolved = {
            host,
            port: parseValidPort(parsed.port),
        };
        if (hasProtocol) {
            resolved.tls = parsed.protocol === 'https:';
        }
        return resolved;
    }
    catch {
        return { host: raw.replace(/\/.*$/, '').replace(/:\d+$/, '').trim() };
    }
}
function normalizeHost(host) {
    return parseGatewayEndpointInput(host).host;
}
function parsePort(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('端口必须在 1 到 65535 之间');
    }
    return parsed;
}
