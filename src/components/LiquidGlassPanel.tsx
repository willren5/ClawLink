import { type PropsWithChildren } from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../theme/adaptiveStyles';

interface LiquidGlassPanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}

export function LiquidGlassPanel(props: LiquidGlassPanelProps): JSX.Element {
  const mode = useThemeMode();

  if (Platform.OS === 'ios') {
    if (isLiquidGlassAvailable()) {
      return (
        <GlassView
          glassEffectStyle="regular"
          colorScheme={mode === 'dark' ? 'dark' : 'light'}
          isInteractive={false}
          style={[styles.base, props.style]}
        >
          {props.children}
        </GlassView>
      );
    }

    return (
      <BlurView
        tint={mode === 'dark' ? 'dark' : 'light'}
        intensity={props.intensity ?? 34}
        style={[styles.base, props.style]}
      >
        {props.children}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: mapColorForMode('#0B1220', mode) },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

const styles = createAdaptiveStyles({
  base: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    overflow: 'hidden',
  },
});
