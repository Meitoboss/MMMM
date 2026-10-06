import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useOta } from '../state/ota';
import { Button, s } from './components';
import { colors, useScheme } from './theme';

/** Home: "an update was downloaded" – it is used from the next start; "再起動" does that now (asks first: the music stops). */
export function OtaBanner() {
  useScheme();
  const { snapshot, restart } = useOta();
  const [hidden, setHidden] = useState(false);
  if (!snapshot.enabled || !snapshot.isUpdatePending || hidden) return null;
  return (
    <View testID="ota-banner" style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <Ionicons name="sparkles" size={26} color={colors.accentText} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.title}>アプリの中身を更新しました</Text>
        <Text style={s.sub}>次に開いたときから使います</Text>
      </View>
      <Button label="再起動" onPress={restart} />
      <Pressable hitSlop={10} onPress={() => setHidden(true)}>
        <Ionicons name="close" size={20} color={colors.sub} />
      </Pressable>
    </View>
  );
}
