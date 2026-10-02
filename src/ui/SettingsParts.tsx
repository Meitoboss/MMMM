import { Text, View, Pressable } from 'react-native';

import { s } from './components';
import { colors, useScheme } from './theme';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  useScheme();
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ color: colors.sub, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 20, marginBottom: 8 }}>{title}</Text>
      <View style={[s.card, { marginHorizontal: 16, overflow: 'hidden' }]}>{children}</View>
    </View>
  );
}

export function Row({ title, sub, children, last }: { title: string; sub?: string; children?: React.ReactNode; last?: boolean }) {
  useScheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {!!sub && <Text style={s.sub}>{sub}</Text>}
      </View>
      {children}
    </View>
  );
}

export function Chips<T extends string | number | null>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  useScheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.label}
            onPress={() => onChange(o.value)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? colors.accent : colors.surface2 }}
          >
            <Text style={{ color: on ? colors.onAccent : colors.text, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

