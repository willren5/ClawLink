import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { mapColorForMode, useAccentColor, useThemeMode } from '../../src/theme/adaptiveStyles';
import { useI18n } from '../../src/lib/i18n';

function NativeTabsLayout(): JSX.Element {
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const activeTint = accentColor;
  const inactiveTint = mapColorForMode('#64748B', themeMode);

  return (
    <NativeTabs
      iconColor={{
        default: inactiveTint,
        selected: activeTint,
      }}
      tintColor={activeTint}
      blurEffect={themeMode === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      minimizeBehavior="never"
      disableTransparentOnScrollEdge={false}
      labelStyle={{
        default: { color: inactiveTint, fontSize: 11, fontWeight: '600' },
        selected: { color: activeTint, fontSize: 11, fontWeight: '700' },
      }}
    >
      <NativeTabs.Trigger name="dashboard">
        <NativeTabs.Trigger.Icon sf={{ default: 'speedometer', selected: 'speedometer' }} />
        <NativeTabs.Trigger.Label hidden>Dashboard</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agents">
        <NativeTabs.Trigger.Icon sf={{ default: 'wrench.and.screwdriver', selected: 'wrench.and.screwdriver.fill' }} />
        <NativeTabs.Trigger.Label hidden>Agents</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="monitor">
        <NativeTabs.Trigger.Icon sf={{ default: 'waveform.path.ecg', selected: 'waveform.path.ecg.rectangle.fill' }} />
        <NativeTabs.Trigger.Label hidden>Monitor</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label hidden>Chat</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'slider.horizontal.3', selected: 'slider.horizontal.3' }} />
        <NativeTabs.Trigger.Label hidden>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function JsTabsLayout(): JSX.Element {
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const { t } = useI18n();
  const navBackground = mapColorForMode('#020617', themeMode);
  const navText = mapColorForMode('#E2E8F0', themeMode);
  const navBorder = mapColorForMode('#1E293B', themeMode);
  const activeTint = accentColor;
  const inactiveTint = mapColorForMode('#64748B', themeMode);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: navBackground },
        headerTintColor: navText,
        lazy: true,
        freezeOnBlur: true,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 78,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          elevation: 0,
        },
        tabBarItemStyle: {
          paddingTop: 10,
        },
        tabBarBackground: () => (
          <BlurView
            tint={themeMode === 'dark' ? 'dark' : 'light'}
            intensity={42}
            style={{
              flex: 1,
              overflow: 'hidden',
              borderTopWidth: 1,
              borderTopColor: navBorder,
              backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.72)' : navBackground,
            }}
          />
        ),
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        sceneStyle: { backgroundColor: navBackground, paddingBottom: 84 },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('tabs_dashboard'),
          tabBarIcon: ({ color, size }) => <Ionicons name="speedometer-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: t('tabs_agents'),
          tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="monitor"
        options={{
          title: t('tabs_monitor'),
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tabs_chat'),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs_settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

export default function TabsLayout(): JSX.Element {
  if (Platform.OS === 'ios') {
    return <NativeTabsLayout />;
  }

  return <JsTabsLayout />;
}
