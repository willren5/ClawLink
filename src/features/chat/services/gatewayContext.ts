import { resolveGatewayProfileAuth, toGatewayTokenState } from '../../../lib/api/gatewayAuth';
import { useConnectionStore } from '../../connection/store/connectionStore';

export interface GatewayAuthContext {
  baseUrl: string;
  token: string;
}

export async function getGatewayAuthContext(): Promise<GatewayAuthContext> {
  const state = useConnectionStore.getState();
  if (!state.activeProfileId) {
    throw new Error('No active gateway profile');
  }

  const profile = state.profiles.find((item) => item.id === state.activeProfileId);
  if (!profile) {
    throw new Error('Active gateway profile not found');
  }

  const auth = await resolveGatewayProfileAuth({
    profile,
    previousRefreshAvailable: state.tokenRefreshAvailable,
  });
  useConnectionStore.setState((current) => ({
    ...toGatewayTokenState(auth.expiresAt, auth.refreshAvailable, current.tokenRefreshAvailable),
  }));

  return {
    baseUrl: auth.baseUrl,
    token: auth.token,
  };
}
