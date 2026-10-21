import { Pressable, Text, View } from 'react-native';

import type { FocusSound } from '../core/focus';
import { focusIdOf } from '../player/focus';
import { FocusBackdrop, focusBeat } from './FocusPlayer';
import { colors } from './theme';

const GROUP_LABEL: Partial<Record<FocusSound['group'], string>> = { focus: '集中', sleep: '回復', nature: '自然の旅' };

/** one card of a 気分 section: the photo, the beat in large, the name, and the button (準備中 until the sound is on the server) */
export function SoundCard({ sound, playing, onPress }: { sound: FocusSound; playing: boolean; onPress: () => void }) {
  const id = focusIdOf(sound.key);
  const beat = focusBeat(id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ marginHorizontal: 16, borderRadius: 22, overflow: 'hidden', backgroundColor: '#101113', padding: 20, minHeight: 170, justifyContent: 'space-between' }}
    >
      <FocusBackdrop id={id} dim={0.5} />
      <Text style={{ color: colors.text, fontSize: 56, fontWeight: '200' }}>{beat} Hz</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{sound.name}</Text>
          <Text style={{ color: colors.text, opacity: 0.8, fontSize: 12 }}>{sound.group === 'none' ? 'ミュージック' : `${GROUP_LABEL[sound.group]} ・ ミュージック`}</Text>
        </View>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{!sound.ready ? '準備中' : playing ? '止める' : '再生'}</Text>
      </View>
    </Pressable>
  );
}

