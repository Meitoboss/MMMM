import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { ACCENT_SWATCHES, EDITABLE, PRESETS, ThemeMode, colors, currentPalette, useScheme, useTheme } from './theme';
import { Chips, Row, Section } from './SettingsParts';
import { s } from './components';

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'dark', label: 'ダーク' },
  { mode: 'light', label: 'ライト' },
  { mode: 'system', label: '端末に合わせる' },
];

/** One editable colour: swatch + hex input (a wrong value is refused and the old one stays). */
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => boolean }) {
  useScheme();
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // changed from outside (preset / reset / swatch): follow it
    setShown(value);
    setText(value);
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: value, borderWidth: 1, borderColor: colors.border }} />
      <Text style={[s.title, { flex: 1 }]}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={() => {
          if (!onChange(text)) {
            setText(value);
            Alert.alert('色を読み取れません', '例: #82e653（6桁の16進数）で入力してください。');
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        style={{ width: 96, color: colors.text, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center' }}
      />
    </View>
  );
}

/** Live preview built from the colours being edited. */
function Preview() {
  useScheme();
  return (
    <View style={{ backgroundColor: colors.bg, padding: 14, gap: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>曲名のサンプル</Text>
        <Text style={{ color: colors.sub, fontSize: 13 }}>アーティスト • 3:45</Text>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surface2, marginTop: 8 }}>
          <View style={{ width: '40%', height: 3, borderRadius: 2, backgroundColor: colors.accent }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>再生</Text>
        </View>
        <View style={{ backgroundColor: colors.surface2, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: colors.text }}>チップ</Text>
        </View>
        <Text style={{ color: colors.accentText, fontWeight: '700' }}>リンク</Text>
      </View>
    </View>
  );
}

export function ThemeEditor() {
  const scheme = useScheme();
  const { mode, setMode, setColor, applyPreset, resetColors } = useTheme();
  const palette = currentPalette();

  return (
    <View>
      <Section title="モード">
        <Chips options={MODES.map((m) => ({ label: m.label, value: m.mode }))} value={mode} onChange={setMode} />
      </Section>

      <Section title="プレビュー">
        <View style={{ padding: 12 }}>
          <Preview />
        </View>
      </Section>

      <Section title="プリセット">
        <Row title="ワンタップで、色の組み合わせを切り替えます" sub="選ぶと、そのモードに切り替わり、下の色が書き換わります。" last />
        <Chips options={PRESETS.map((p) => ({ label: p.label, value: p.id }))} value="" onChange={(id) => { const p = PRESETS.find((x) => x.id === id); if (p) applyPreset(p); }} />
      </Section>

      <Section title={`色を編集（いまのモード: ${scheme === 'dark' ? 'ダーク' : 'ライト'}）`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          {ACCENT_SWATCHES.map((hex) => (
            <Pressable
              key={hex}
              onPress={() => setColor(scheme, 'accent', hex)}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hex, borderWidth: palette.accent === hex ? 3 : 1, borderColor: palette.accent === hex ? colors.text : colors.border }}
            />
          ))}
        </View>
        {EDITABLE.map((e) => (
          <ColorRow key={e.key} label={e.label} value={palette[e.key]} onChange={(hex) => setColor(scheme, e.key, hex)} />
        ))}
        <Pressable onPress={() => Alert.alert('このモードの色を初期値に戻しますか？', undefined, [{ text: '戻す', style: 'destructive', onPress: () => resetColors(scheme) }, { text: 'キャンセル', style: 'cancel' }])}>
          <Row title="このモードの色を初期値に戻す" last>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>戻す</Text>
          </Row>
        </Pressable>
      </Section>
    </View>
  );
}
