import { Pressable, Text, View } from 'react-native';

import type { FocusSound } from '../core/focus';
import { tuningOf } from '../core/tuning';
import { focusIdOf } from '../player/focus';
import { FocusBackdrop, focusBeat } from './FocusPlayer';
import { colors } from './theme';

/**
 * One card of a sound: a tall photo card, the beat in large at the top, and the name at the bottom.
 * The width is given by the screen it is in (a row, or two in a grid).
 */
export function SoundCard({ sound, playing, onPress, width = 200 }: { sound: FocusSound; playing: boolean; onPress: () => void; width?: number }) {
  const id = focusIdOf(sound.key);
  const beat = focusBeat(id);
  const tuning = sound.tuning ? tuningOf(sound.tuning) : undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ width, height: width * 1.4, borderRadius: 22, overflow: 'hidden', backgroundColor: '#101113', padding: 16, justifyContent: 'space-between' }}
    >
      <FocusBackdrop id={id} dim={0.45} />
      <Text style={{ color: colors.text, fontSize: 40, fontWeight: '200' }}>{beat} Hz</Text>
      <View>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{sound.name}</Text>
        <Text style={{ color: colors.text, opacity: 0.75, fontSize: 12, marginTop: 2 }}>
          {tuning ? `${tuning.title} ・ ` : ''}ミュージック{!sound.ready ? '　準備中' : playing ? '　止める' : ''}
        </Text>
      </View>
    </Pressable>
  );
}
