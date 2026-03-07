"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGatewayInviteBundle = buildGatewayInviteBundle;
exports.buildGatewayFullSetupBundle = buildGatewayFullSetupBundle;
function encodePair(key, value) {
    return `${key}: ${value}`;
}
function buildGatewayInviteBundle(profile) {
    const lines = [
        encodePair('Gateway Host', profile.host),
        encodePair('Port', String(profile.port)),
        encodePair('TLS', profile.tls ? 'true' : 'false'),
        encodePair('Profile', profile.name),
    ];
    return lines.join('\n');
}
function buildGatewayFullSetupBundle(profile, token) {
    const lines = [
        encodePair('Gateway Host', profile.host),
        encodePair('Port', String(profile.port)),
        encodePair('TLS', profile.tls ? 'true' : 'false'),
        encodePair('Profile', profile.name),
        encodePair('API Token', token),
    ];
    return lines.join('\n');
}
