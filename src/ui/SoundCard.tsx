import { Pressable, Text, View } from 'react-native';

import type { FocusSound } from '../core/focus';
import { tuningOf } from '../core/tuning';
import { focusIdOf } from '../player/focus';
import { FocusBackdrop, focusBeat } from './FocusPlayer';
import { colors } from './theme';

/**
 * One card of a sound. `wide` is the usual card (a full-width bar: the beat, the name and the button).
 * Otherwise it is a tall photo card, with the width given by the screen it is in (a row, or two in a grid).
 */
export function SoundCard({ sound, playing, onPress, width = 200, wide = false }: { sound: FocusSound; playing: boolean; onPress: () => void; width?: number; wide?: boolean }) {
  const id = focusIdOf(sound.key);
  const beat = focusBeat(id);
  const tuning = sound.tuning ? tuningOf(sound.tuning) : undefined;
  const label = tuning ? `${tuning.title} ・ ミュージック` : 'ミュージック';
  if (wide) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={{ width, borderRadius: 22, overflow: 'hidden', backgroundColor: '#101113', padding: 20, minHeight: 170, justifyContent: 'space-between' }}
      >
        <FocusBackdrop id={id} dim={0.5} />
        <Text style={{ color: colors.text, fontSize: 56, fontWeight: '200' }}>{beat} Hz</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{sound.name}</Text>
            <Text style={{ color: colors.text, opacity: 0.8, fontSize: 12 }}>{label}</Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{!sound.ready ? '準備中' : playing ? '止める' : '再生'}</Text>
        </View>
      </Pressable>
    );
  }
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
          {label}{!sound.ready ? '　準備中' : playing ? '　止める' : ''}
        </Text>
      </View>
    </Pressable>
  );
}
