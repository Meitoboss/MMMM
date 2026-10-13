import { Pressable, ScrollView, Text, View } from 'react-native';

import { SORT_LABEL, type SortKey, type SortTab, isRelease, sortCaption, sortOptions } from '../core/librarySort';
import { useReleaseYears } from '../state/releaseYears';
import { colors, useScheme } from './theme';

/**
 * Under the tabs of the Library: the choices of order (new → old, old → new, by name, by release), a line saying which day the
 * order follows, and – for the release order – how many albums have no known year, with a button that looks them up.
 */
export function SortBar({ tab, value, onChange, missingYears }: { tab: SortTab; value: SortKey; onChange: (k: SortKey) => void; missingYears: number }) {
  useScheme();
  const years = useReleaseYears();
  return (
    <View testID="sort-bar" style={{ gap: 6, paddingBottom: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
        <Text style={{ color: colors.sub, fontSize: 12 }}>並び順</Text>
        {sortOptions(tab).map((k) => (
          <Pressable
            key={k}
            testID={`sort-${k}`}
            accessibilityState={{ selected: value === k }}
            onPress={() => onChange(k)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, minHeight: 32, justifyContent: 'center', borderRadius: 16, backgroundColor: value === k ? colors.accent : colors.surface2 }}
          >
            <Text style={{ color: value === k ? colors.onAccent : colors.text, fontWeight: value === k ? '800' : '500', fontSize: 13 }}>{SORT_LABEL[k]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text testID="sort-caption" style={{ color: colors.sub, fontSize: 12, paddingHorizontal: 16 }}>{sortCaption(tab, value)}</Text>
      {isRelease(value) && (
        <View style={{ paddingHorizontal: 16, gap: 6 }}>
          {years.running ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text testID="years-progress" style={{ flex: 1, color: colors.accentText, fontSize: 13 }}>発売年を調べています… {years.done} / {years.total}</Text>
              <Pressable testID="years-cancel" onPress={years.cancel} disabled={years.cancelRequested} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface2, opacity: years.cancelRequested ? 0.5 : 1 }}>
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>{years.cancelRequested ? '中止しています…' : '中止'}</Text>
              </Pressable>
            </View>
          ) : missingYears > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text testID="years-missing" style={{ flex: 1, color: colors.sub, fontSize: 13 }}>発売年が分からないアルバムが {missingYears}件あります（その曲は、最後に並びます）</Text>
              <Pressable testID="years-start" onPress={() => void years.start()} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.accent }}>
                <Text style={{ color: colors.onAccent, fontWeight: '800', fontSize: 13 }}>調べる</Text>
              </Pressable>
            </View>
          ) : null}
          {!!years.message && !years.running && <Text testID="years-message" style={{ color: colors.sub, fontSize: 12 }}>{years.message}</Text>}
          {missingYears > 0 && !years.running && <Text style={{ color: colors.sub, fontSize: 11 }}>調べるときに、通信します。アルバムのページを開くと、その年は、自動で覚えます。</Text>}
        </View>
      )}
    </View>
  );
}
