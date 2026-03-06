"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGatewayImport = parseGatewayImport;
const network_1 = require("../../../lib/utils/network");
function compactImportedConfig(config) {
    return {
        host: config.host,
        ...(typeof config.port === 'number' ? { port: config.port } : {}),
        ...(config.token ? { token: config.token } : {}),
        ...(typeof config.tls === 'boolean' ? { tls: config.tls } : {}),
        ...(config.name ? { name: config.name } : {}),
    };
}
function sanitizeValue(value) {
    return (value ?? '').trim().replace(/^['"<\s]+|['">\s]+$/g, '').trim();
}
function parseBooleanish(value) {
    const normalized = sanitizeValue(value).toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (['1', 'true', 'yes', 'on', 'https', 'tls'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off', 'http', 'plain'].includes(normalized)) {
        return false;
    }
    return undefined;
}
function parsePortValue(value) {
    const normalized = sanitizeValue(value);
    if (!normalized) {
        return undefined;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return undefined;
    }
    return parsed;
}
function applyEndpoint(current, value) {
    const normalized = sanitizeValue(value);
    if (!normalized) {
        return current;
    }
    const parsed = (0, network_1.parseGatewayEndpointInput)(normalized);
    return {
        ...current,
        host: parsed.host || current.host,
        port: parsed.port ?? current.port,
        tls: typeof parsed.tls === 'boolean' ? parsed.tls : current.tls,
    };
}
function applyQueryParams(url, current) {
    let next = { ...current };
    next = applyEndpoint(next, url.searchParams.get('uri') ?? url.searchParams.get('baseUrl'));
    const host = url.searchParams.get('host');
    if (host) {
        next = applyEndpoint(next, host);
    }
    const directPort = parsePortValue(url.searchParams.get('port'));
    if (directPort) {
        next.port = directPort;
    }
    const token = sanitizeValue(url.searchParams.get('token') ?? url.searchParams.get('api_token'));
    if (token) {
        next.token = token;
    }
    const name = sanitizeValue(url.searchParams.get('name') ?? url.searchParams.get('profile'));
    if (name) {
        next.name = name;
    }
    const tls = parseBooleanish(url.searchParams.get('tls') ?? url.searchParams.get('https'));
    if (typeof tls === 'boolean') {
        next.tls = tls;
    }
    return next;
}
function parseJsonObject(raw) {
    if (!raw.trim().startsWith('{')) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        let next = { host: '' };
        next = applyEndpoint(next, typeof parsed.uri === 'string'
            ? parsed.uri
            : typeof parsed.baseUrl === 'string'
                ? parsed.baseUrl
                : typeof parsed.url === 'string'
                    ? parsed.url
                    : undefined);
        if (typeof parsed.host === 'string') {
            next = applyEndpoint(next, parsed.host);
        }
        const port = parsePortValue(typeof parsed.port === 'number' ? String(parsed.port) : typeof parsed.port === 'string' ? parsed.port : undefined);
        if (port) {
            next.port = port;
        }
        const token = sanitizeValue(typeof parsed.token === 'string' ? parsed.token : typeof parsed.apiToken === 'string' ? parsed.apiToken : undefined);
        if (token) {
            next.token = token;
        }
        const name = sanitizeValue(typeof parsed.name === 'string' ? parsed.name : typeof parsed.profileName === 'string' ? parsed.profileName : undefined);
        if (name) {
            next.name = name;
        }
        const tls = typeof parsed.tls === 'boolean'
            ? parsed.tls
            : typeof parsed.https === 'boolean'
                ? parsed.https
                : parseBooleanish(typeof parsed.tls === 'string' ? parsed.tls : typeof parsed.https === 'string' ? parsed.https : undefined);
        if (typeof tls === 'boolean') {
            next.tls = tls;
        }
        return next.host || next.token ? compactImportedConfig(next) : null;
    }
    catch {
        return null;
    }
}
function parseUrlLike(raw) {
    const normalized = sanitizeValue(raw);
    if (!normalized) {
        return null;
    }
    const looksLikeUrl = /^https?:\/\//i.test(normalized) || /^clawlink:\/\//i.test(normalized);
    if (!looksLikeUrl) {
        return null;
    }
    try {
        const url = new URL(normalized);
        if (url.protocol === 'clawlink:' && url.hostname.toLowerCase() === 'connect') {
            return compactImportedConfig(applyQueryParams(url, { host: '' }));
        }
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return compactImportedConfig(applyEndpoint({ host: '' }, normalized));
        }
    }
    catch {
        return null;
    }
    return null;
}
function extractLabelValue(line, labels) {
    const normalizedLine = line.trim();
    for (const label of labels) {
        const pattern = new RegExp(`^${label}\\s*[:=]\\s*(.+)$`, 'i');
        const match = normalizedLine.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
    return undefined;
}
function extractTokenFromFreeform(raw) {
    const tokenLine = raw.match(/(?:api\s*token|gateway\s*token|token)\s*[:=]\s*([^\n\r]+)/i)?.[1] ??
        raw.match(/\bbearer\s+([^\s]+)/i)?.[1];
    const normalized = sanitizeValue(tokenLine);
    return normalized || undefined;
}
function extractNameFromFreeform(raw) {
    const fromKeyValue = raw.match(/(?:profile|name)\s*[:=]\s*([^\n\r]+)/i)?.[1];
    const normalized = sanitizeValue(fromKeyValue);
    return normalized || undefined;
}
function extractTlsFromFreeform(raw) {
    const tlsLine = raw.match(/\b(?:tls|https)\s*[:=]\s*([^\n\r]+)/i)?.[1];
    if (tlsLine) {
        return parseBooleanish(tlsLine);
    }
    if (/\bhttps:\/\//i.test(raw)) {
        return true;
    }
    if (/\bhttp:\/\//i.test(raw)) {
        return false;
    }
    return undefined;
}
function extractEndpointFromFreeform(raw) {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    let next = { host: '' };
    for (const line of lines) {
        const hostValue = extractLabelValue(line, ['gateway\\s*host', 'host', 'hostname']);
        if (hostValue) {
            next = applyEndpoint(next, hostValue);
        }
        const uriValue = extractLabelValue(line, ['gateway\\s*url', 'gateway\\s*uri', 'base\\s*url', 'uri', 'url']);
        if (uriValue) {
            next = applyEndpoint(next, uriValue);
        }
        const portValue = extractLabelValue(line, ['port']);
        if (portValue) {
            next.port = parsePortValue(portValue) ?? next.port;
        }
    }
    const inlineEndpointMatch = raw.match(/\bhttps?:\/\/[^\s'"]+/i);
    if (inlineEndpointMatch) {
        next = applyEndpoint(next, inlineEndpointMatch[0]);
    }
    if (!next.host) {
        const looseHostMatch = raw.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z0-9.-]+\.(?:local|lan|com|net|org|dev|io)\b/i);
        if (looseHostMatch) {
            next = applyEndpoint(next, looseHostMatch[0]);
        }
    }
    const token = extractTokenFromFreeform(raw);
    if (token) {
        next.token = token;
    }
    const name = extractNameFromFreeform(raw);
    if (name) {
        next.name = name;
    }
    const tls = extractTlsFromFreeform(raw);
    if (typeof tls === 'boolean') {
        next.tls = tls;
    }
    return next;
}
function parseGatewayImport(raw) {
    const normalized = raw.trim();
    if (!normalized) {
        return null;
    }
    const fromJson = parseJsonObject(normalized);
    if (fromJson) {
        return fromJson;
    }
    const fromUrl = parseUrlLike(normalized);
    if (fromUrl) {
        return fromUrl;
    }
    const fromFreeform = extractEndpointFromFreeform(normalized);
    if (fromFreeform.host || fromFreeform.token) {
        return compactImportedConfig(fromFreeform);
    }
    return null;
}
