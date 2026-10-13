import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';

import { s } from './components';
import { showAppAlert } from './dialogs';
import { colors, useScheme } from './theme';

/**
 * A group of rows. With `collapsible`, only the title shows until it is tapped (the rows open below it).
 */
export function Section({ title, children, collapsible }: { title: string; children: React.ReactNode; collapsible?: boolean }) {
  useScheme();
  const [open, setOpen] = useState(false);
  const label = <Text style={{ color: colors.sub, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>{title}</Text>;
  return (
    <View style={{ marginTop: 22 }}>
      {collapsible ? (
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 4, marginBottom: open ? 8 : 0 }}
        >
          {label}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.sub} />
        </Pressable>
      ) : (
        <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>{label}</View>
      )}
      {(!collapsible || open) && <View style={[s.card, { marginHorizontal: 16, overflow: 'hidden' }]}>{children}</View>}
    </View>
  );
}

/** the ⓘ button: opens a pop-up with the explanation of the row */
function InfoButton({ title, text }: { title: string; text: string }) {
  useScheme();
  return (
    <Pressable
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`${title}の説明`}
      onPress={() => showAppAlert({ icon: 'information-circle-outline', title, message: text })}
    >
      <Ionicons name="information-circle-outline" size={20} color={colors.sub} />
    </Pressable>
  );
}

/**
 * One line of a group. `sub` is shown under the title; `info` is shown behind an ⓘ button instead
 * (for the longer explanations, so that the list stays short).
 */
export function Row({ title, sub, info, children, last }: { title: string; sub?: string; info?: string; children?: React.ReactNode; last?: boolean }) {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[s.title, { flexShrink: 1 }]}>{title}</Text>
          {!!info && <InfoButton title={title} text={info} />}
        </View>
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
