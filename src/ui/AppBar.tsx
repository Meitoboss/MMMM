import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { colors, useScheme } from './theme';

/** the top of every tab: the logo and "Music space", with the name of the page below them */
export function AppBarTitle({ title }: { title: string }) {
  useScheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Image source={require('../../assets/logo-mark.png')} style={{ width: 22, height: 24 }} contentFit="contain" />
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '900', letterSpacing: -0.3 }}>
          Music <Text style={{ fontWeight: '300' }}>space</Text>
        </Text>
      </View>
      <Text style={{ color: colors.sub, fontSize: 13, fontWeight: '700' }}>{title}</Text>
    </View>
  );
}

/** the menu at the top right of every tab: opens the settings */
export function SettingsButton() {
  useScheme();
  const router = useRouter();
  return (
    <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel="設定" onPress={() => router.push('/settings')} style={{ paddingHorizontal: 16 }}>
      <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
    </Pressable>
  );
}
