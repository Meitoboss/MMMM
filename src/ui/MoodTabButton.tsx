import { Ionicons } from '@expo/vector-icons';
import { Pressable, PressableProps, Text } from 'react-native';

import { colors, useScheme } from './theme';

/** the 気分 button in the tab bar: the same size, icon and label as the other tabs */
export function MoodTabButton({ onPress, onLongPress, accessibilityState }: PressableProps & { accessibilityState?: { selected?: boolean } }) {
  useScheme();
  const focused = !!accessibilityState?.selected;
  const tint = focused ? colors.accentText : colors.sub;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel="気分ダイヤル" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }}>
      <Ionicons name={focused ? 'disc' : 'disc-outline'} size={24} color={tint} />
      <Text style={{ fontSize: 11, fontWeight: '600', color: tint, marginTop: 2 }}>気分</Text>
    </Pressable>
  );
}
