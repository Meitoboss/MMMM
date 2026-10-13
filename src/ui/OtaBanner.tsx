import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useOta } from '../state/ota';
import { Button, s } from './components';
import { colors, useScheme } from './theme';

/** Home: "a new version was downloaded" – "いま反映" switches to it now, with the app staying open (asks first when music is playing). */
export function OtaBanner() {
  useScheme();
  const { snapshot, restart } = useOta();
  const [hidden, setHidden] = useState(false);
  if (!snapshot.enabled || !snapshot.isUpdatePending || hidden) return null;
  return (
    <View testID="ota-banner" style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <Ionicons name="sparkles" size={26} color={colors.accentText} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.title}>新しい版を取得しました</Text>
        <Text style={s.sub}>反映すると、アプリを閉じずに切り替わります</Text>
      </View>
      <Button label="いま反映" onPress={restart} />
      <Pressable hitSlop={10} onPress={() => setHidden(true)}>
        <Ionicons name="close" size={20} color={colors.sub} />
      </Pressable>
    </View>
  );
}
