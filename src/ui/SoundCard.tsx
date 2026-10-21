import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import type { FocusSound } from '../core/focus';
import { tuningOf } from '../core/tuning';
import { focusIdOf } from '../player/focus';
import { FocusBackdrop, focusBeat } from './FocusPlayer';
import { colors } from './theme';

/**
 * One card of a sound. `row` is a list row (a small tall photo, the name, and a round play button) for the シナリオ screen.
 * `wide` is the full-width bar (the beat, the name and the button) for the 脳をチューニング pages.
 * Otherwise it is a tall photo card, with the width given by the screen it is in (a row, or two in a grid).
 */
export function SoundCard({ sound, playing, onPress, width = 200, wide = false, row = false }: { sound: FocusSound; playing: boolean; onPress: () => void; width?: number; wide?: boolean; row?: boolean }) {
  const id = focusIdOf(sound.key);
  const beat = focusBeat(id);
  const tuning = sound.tuning ? tuningOf(sound.tuning) : undefined;
  const label = tuning ? `${tuning.title} ・ ミュージック` : 'ミュージック';
  if (row) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 86, height: 120, borderRadius: 14, overflow: 'hidden', backgroundColor: '#101113', padding: 10, justifyContent: 'flex-start' }}>
          <FocusBackdrop id={id} dim={0.4} />
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '200' }}>{beat} Hz</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '500' }}>{sound.name}</Text>
          <Text style={{ color: colors.sub, fontSize: 14 }}>{label}{!sound.ready ? '　準備中' : ''}</Text>
        </View>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
          <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.bg} style={{ marginLeft: playing ? 0 : 3 }} />
        </View>
      </Pressable>
    );
  }
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
