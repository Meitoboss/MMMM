import { Ionicons } from '@expo/vector-icons';
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native';

import { useUpdate } from '../state/update';
import { Button, s } from './components';
import { colors, useScheme } from './theme';

/** "A new version is out" – shown at the top of Home, once per version (「あとで」 closes it). */
export function UpdateBanner() {
  useScheme();
  const result = useUpdate((u) => u.result);
  const dismissed = useUpdate((u) => u.dismissed);
  const dismiss = useUpdate((u) => u.dismiss);
  if (result?.kind !== 'newer' || dismissed === result.feed.version) return null;
  const { feed, target } = result;
  const open = () => {
    if (!target) return;
    Linking.openURL(target).catch(() => Alert.alert('開けませんでした', Platform.OS === 'ios' ? `AltStore が入っているか確認してください。\n${target}` : target));
  };
  return (
    <View testID="update-banner" style={[s.card, { marginHorizontal: 16, marginBottom: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <Ionicons name="arrow-up-circle" size={28} color={colors.accentText} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.title}>新しい版があります（{feed.version}）</Text>
        {!!feed.notes && <Text style={s.sub} numberOfLines={2}>{feed.notes}</Text>}
        <Text style={s.sub}>{Platform.OS === 'ios' ? 'AltStore で更新できます' : 'ダウンロードして、入れ直してください'}</Text>
      </View>
      {!!target && <Button label="開く" onPress={open} />}
      <Pressable hitSlop={10} onPress={dismiss}>
        <Ionicons name="close" size={20} color={colors.sub} />
      </Pressable>
    </View>
  );
}
