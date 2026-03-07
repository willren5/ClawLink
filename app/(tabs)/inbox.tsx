import { Suspense, lazy } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adaptiveColor, createAdaptiveStyles } from '../../src/theme/adaptiveStyles';

const IncidentInboxScreen = lazy(async () => {
  const module = await import('../../src/features/notifications/screens/IncidentInboxScreen');
  return { default: module.IncidentInboxScreen };
});

function RouteFallback(): JSX.Element {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color={adaptiveColor('#38BDF8')} />
    </View>
  );
}

export default function InboxRoute(): JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Suspense fallback={<RouteFallback />}>
        <IncidentInboxScreen />
      </Suspense>
    </SafeAreaView>
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
