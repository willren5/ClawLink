import { Suspense, lazy } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adaptiveColor, createAdaptiveStyles } from '../../src/theme/adaptiveStyles';

const ChatScreen = lazy(async () => {
  const module = await import('../../src/features/chat/screens/ChatScreen');
  return { default: module.ChatScreen };
});

function RouteFallback(): JSX.Element {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color={adaptiveColor('#38BDF8')} />
    </View>
  );
}

export default function ChatRoute(): JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Suspense fallback={<RouteFallback />}>
        <ChatScreen />
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
