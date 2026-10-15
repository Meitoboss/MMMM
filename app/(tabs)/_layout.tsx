import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBarTitle, SettingsButton } from '../../src/ui/AppBar';
import { MoodTabButton } from '../../src/ui/MoodTabButton';
import { TAB_HEIGHT, colors, useScheme } from '../../src/ui/theme';

const icon = (name: keyof typeof Ionicons.glyphMap, outline: keyof typeof Ionicons.glyphMap) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={focused ? name : outline} size={size} color={color} />
  );

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  useScheme();
  return (
    <Tabs
      screenOptions={{
        sceneStyle: { backgroundColor: colors.bg },
        headerShown: true,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitle: ({ children }) => <AppBarTitle title={String(children)} />,
        headerRight: () => <SettingsButton />,
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.sub,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: TAB_HEIGHT + insets.bottom },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'ホーム', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="search" options={{ title: '検索', tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen name="mood" options={{ title: '気分', tabBarIcon: icon('disc', 'disc-outline'), tabBarButton: (props) => <MoodTabButton {...props} /> }} />
      <Tabs.Screen name="new" options={{ title: '新着', tabBarIcon: icon('sparkles', 'sparkles-outline') }} />
      <Tabs.Screen name="library" options={{ title: 'ライブラリ', tabBarIcon: icon('library', 'library-outline') }} />
    </Tabs>
  );
}
