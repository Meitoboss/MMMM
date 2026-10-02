import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import type { MusicItem, Section, SongItem } from '../core/types';
import { useOffline } from '../state/offline';
import { songMenu, openItem } from './actions';
import { colors, dynamicStyles, useScheme } from './theme';

export function Cover({ uri, size, round }: { uri?: string; size: number; round?: boolean }) {
  useScheme();
  const radius = round ? size / 2 : 6;
  if (!uri) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="musical-notes" size={Math.round(size * 0.42)} color={colors.sub} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surface2 }}
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
  useScheme();
  const saved = useOffline((st) => !!st.ids[song.id]);
  const job = useOffline((st) => st.jobs[song.id]);
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
      {job?.status === 'downloading' ? (
        <Text style={{ color: colors.accentText, fontSize: 12, fontWeight: '700' }}>{Math.round(job.progress * 100)}%</Text>
      ) : job?.status === 'queued' ? (
        <Ionicons name="time-outline" size={16} color={colors.sub} />
      ) : job?.status === 'error' ? (
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
      ) : saved ? (
        <Ionicons name="arrow-down-circle" size={18} color={colors.accentText} />
      ) : null}
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
      return i.subscribersText ?? 'アーティスト';
    case 'playlist':
      return [i.channel?.name, i.songCount ? `${i.songCount}曲` : undefined].filter(Boolean).join(' • ');
  }
}

/** Square card used in carousels */
export function ItemCard({ item, onPress, size = 140 }: { item: MusicItem; onPress: () => void; size?: number }) {
  useScheme();
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
  useScheme();
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
          {KIND_LABEL[item.kind]}
          {itemSubtitle(item) ? ` • ${itemSubtitle(item)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const KIND_LABEL: Record<MusicItem['kind'], string> = { song: '曲', video: 'ビデオ', album: 'アルバム', artist: 'アーティスト', playlist: 'プレイリスト' };

export function SectionCarousel({ section }: { section: Section }) {
  const router = useRouter();
  useScheme();
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
  useScheme();
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.accentText} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  useScheme();
  return (
    <View style={s.center}>
      <Ionicons name="cloud-offline-outline" size={36} color={colors.sub} />
      <Text style={[s.sub, { textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }]}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={s.btn}>
          <Text style={{ color: colors.onAccent, fontWeight: '600' }}>再試行</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Button({ label, onPress, icon, secondary }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; secondary?: boolean }) {
  useScheme();
  return (
    <Pressable onPress={onPress} style={[s.btn, secondary && { backgroundColor: colors.surface2 }]}>
      {icon && <Ionicons name={icon} size={18} color={secondary ? colors.text : colors.onAccent} style={{ marginRight: 6 }} />}
      <Text style={{ color: secondary ? colors.text : colors.onAccent, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export const s = dynamicStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  rowText: { flex: 1 },
  index: { width: 24, color: c.sub, textAlign: 'center' },
  title: { color: c.text, fontSize: 15, fontWeight: '500' },
  sub: { color: c.sub, fontSize: 13, marginTop: 2 },
  h1: { color: c.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  h2: { color: c.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  btn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.accent, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, marginTop: 12 },
  card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border },
}));
