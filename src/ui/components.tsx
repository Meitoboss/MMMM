import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MusicItem, Section, SongItem } from '../core/types';
import { songMenu, openItem } from './actions';
import { colors } from './theme';

export function Cover({ uri, size, round }: { uri?: string; size: number; round?: boolean }) {
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={{ width: size, height: size, borderRadius: round ? size / 2 : 6, backgroundColor: colors.surface2 }}
      contentFit="cover"
      transition={150}
    />
  );
}

export function SongRow({
  song,
  onPress,
  index,
  right,
  onChanged,
}: {
  song: SongItem;
  onPress: () => void;
  index?: number;
  right?: ReactNode;
  onChanged?: () => void;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => songMenu(router, song, onChanged)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surface }]}
    >
      {index !== undefined && <Text style={s.index}>{index + 1}</Text>}
      <Cover uri={song.thumbnail} size={48} />
      <View style={s.rowText}>
        <Text style={s.title} numberOfLines={1}>
          {song.explicit ? '🅴 ' : ''}
          {song.title}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {song.artists.map((a) => a.name).join(', ')}
          {song.durationText ? ` • ${song.durationText}` : ''}
        </Text>
      </View>
      {right}
      <Pressable hitSlop={12} onPress={() => songMenu(router, song, onChanged)}>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.sub} />
      </Pressable>
    </Pressable>
  );
}

function itemTitle(i: MusicItem): string {
  return i.kind === 'artist' ? i.name : i.title;
}
function itemSubtitle(i: MusicItem): string {
  switch (i.kind) {
    case 'song':
    case 'video':
      return i.artists.map((a) => a.name).join(', ');
    case 'album':
      return [i.artists.map((a) => a.name).join(', '), i.year].filter(Boolean).join(' • ');
    case 'artist':
      return i.subscribersText ?? 'Artist';
    case 'playlist':
      return [i.channel?.name, i.songCount ? `${i.songCount} songs` : undefined].filter(Boolean).join(' • ');
  }
}

/** Square card used in carousels */
export function ItemCard({ item, onPress, size = 140 }: { item: MusicItem; onPress: () => void; size?: number }) {
  return (
    <Pressable onPress={onPress} style={{ width: size }}>
      <Cover uri={item.thumbnail} size={size} round={item.kind === 'artist'} />
      <Text style={[s.title, { marginTop: 6, textAlign: item.kind === 'artist' ? 'center' : 'left' }]} numberOfLines={1}>
        {itemTitle(item)}
      </Text>
      <Text style={[s.sub, { textAlign: item.kind === 'artist' ? 'center' : 'left' }]} numberOfLines={1}>
        {itemSubtitle(item)}
      </Text>
    </Pressable>
  );
}

/** Generic row for search results of any kind */
export function ItemRow({ item, context }: { item: MusicItem; context?: SongItem[] }) {
  const router = useRouter();
  if (item.kind === 'song') {
    return <SongRow song={item} onPress={() => openItem(router, item, context)} />;
  }
  return (
    <Pressable onPress={() => openItem(router, item)} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surface }]}>
      <Cover uri={item.thumbnail} size={48} round={item.kind === 'artist'} />
      <View style={s.rowText}>
        <Text style={s.title} numberOfLines={1}>
          {itemTitle(item)}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {capitalize(item.kind)}
          {itemSubtitle(item) ? ` • ${itemSubtitle(item)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const capitalize = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function SectionCarousel({ section }: { section: Section }) {
  const router = useRouter();
  const songs = section.items.filter((i): i is SongItem => i.kind === 'song');
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.h2}>{section.title}</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={section.items}
        keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) => <ItemCard item={item} onPress={() => openItem(router, item, songs)} />}
      />
    </View>
  );
}

export function Loading() {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={s.center}>
      <Ionicons name="cloud-offline-outline" size={36} color={colors.sub} />
      <Text style={[s.sub, { textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }]}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={s.btn}>
          <Text style={{ color: '#000', fontWeight: '600' }}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Button({ label, onPress, icon, secondary }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, secondary && { backgroundColor: colors.surface2 }]}>
      {icon && <Ionicons name={icon} size={18} color={secondary ? colors.text : '#000'} style={{ marginRight: 6 }} />}
      <Text style={{ color: secondary ? colors.text : '#000', fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  rowText: { flex: 1 },
  index: { width: 24, color: colors.sub, textAlign: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '500' },
  sub: { color: colors.sub, fontSize: 13, marginTop: 2 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  btn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginTop: 12 },
});
