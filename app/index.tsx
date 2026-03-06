import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useConnectionStore } from '../src/features/connection/store/connectionStore';
import { usePermissionsStore } from '../src/features/onboarding/store/permissionsStore';
import { adaptiveColor, createAdaptiveStyles } from '../src/theme/adaptiveStyles';

export default function IndexRoute(): JSX.Element {
  const router = useRouter();
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const isConnectionHydrated = useConnectionStore((state) => state.isHydrated);
  const isPermissionsHydrated = usePermissionsStore((state) => state.isHydrated);
  const hasRequiredPermissions = usePermissionsStore((state) => state.hasRequiredPermissions());
  const storesReady = (isConnectionHydrated && isPermissionsHydrated) || hydrationTimedOut;

  useEffect(() => {
    if (isConnectionHydrated && isPermissionsHydrated) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHydrationTimedOut(true);
    }, 1500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isConnectionHydrated, isPermissionsHydrated]);

  useEffect(() => {
    if (!storesReady) {
      return;
    }

    if (!hasRequiredPermissions) {
      router.replace('/permissions');
      return;
    }

    if (activeProfileId) {
      router.replace('/(tabs)/dashboard');
      return;
    }

    router.replace('/connection');
  }, [activeProfileId, hasRequiredPermissions, router, storesReady]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={adaptiveColor('#38BDF8')} />
    </View>
  );
}

const styles = createAdaptiveStyles({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
