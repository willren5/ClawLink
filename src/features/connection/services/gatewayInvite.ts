import type { GatewayProfile } from '../types';

function encodePair(key: string, value: string): string {
  return `${key}: ${value}`;
}

export function buildGatewayInviteBundle(profile: Pick<GatewayProfile, 'host' | 'port' | 'tls' | 'name'>): string {
  const lines = [
    encodePair('Gateway Host', profile.host),
    encodePair('Port', String(profile.port)),
    encodePair('TLS', profile.tls ? 'true' : 'false'),
    encodePair('Profile', profile.name),
  ];

  return lines.join('\n');
}

export function buildGatewayFullSetupBundle(
  profile: Pick<GatewayProfile, 'host' | 'port' | 'tls' | 'name'>,
  token: string,
): string {
  const lines = [
    encodePair('Gateway Host', profile.host),
    encodePair('Port', String(profile.port)),
    encodePair('TLS', profile.tls ? 'true' : 'false'),
    encodePair('Profile', profile.name),
    encodePair('API Token', token),
  ];

  return lines.join('\n');
}
