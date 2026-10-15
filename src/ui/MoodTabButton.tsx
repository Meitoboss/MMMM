import { Ionicons } from '@expo/vector-icons';
import { Pressable, PressableProps, Text, View } from 'react-native';

import { colors, useScheme } from './theme';

/** the 気分 button in the middle of the tab bar: a round knob that sits a little above the bar */
export function MoodTabButton({ onPress, onLongPress, accessibilityState }: PressableProps & { accessibilityState?: { selected?: boolean } }) {
  useScheme();
  const focused = !!accessibilityState?.selected;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel="気分ダイヤル" style={{ flex: 1, alignItems: 'center' }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          marginTop: -22,
          backgroundColor: focused ? colors.accentText : colors.accent,
          borderWidth: 4,
          borderColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 6,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Ionicons name="disc" size={26} color={colors.onAccent} />
      </View>
      <Text style={{ fontSize: 11, fontWeight: '600', color: focused ? colors.accentText : colors.sub, marginTop: 2 }}>気分</Text>
    </Pressable>
  );
}
