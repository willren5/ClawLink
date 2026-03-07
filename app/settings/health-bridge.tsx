import { Suspense, lazy } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { adaptiveColor, createAdaptiveStyles } from '../../src/theme/adaptiveStyles';

const HealthBridgeScreen = lazy(async () => {
  const module = await import('../../src/features/health-bridge/screens/HealthBridgeScreen');
  return { default: module.HealthBridgeScreen };
});

function RouteFallback(): JSX.Element {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color={adaptiveColor('#38BDF8')} />
    </View>
  );
}

export default function HealthBridgeRoute(): JSX.Element {
  return (
    <View style={styles.safeArea}>
      <Suspense fallback={<RouteFallback />}>
        <HealthBridgeScreen />
      </Suspense>
    </View>
  );
}

const styles = createAdaptiveStyles({
  fallback: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#020617',
  },
});
