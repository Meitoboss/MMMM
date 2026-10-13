import { Ionicons } from '@expo/vector-icons';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { create } from 'zustand';

import { colors, useScheme } from './theme';

/**
 * Menus and text prompts that work on both platforms.
 * iOS uses the system ones (ActionSheetIOS / Alert.prompt); Android has no equivalent, so <DialogHost /> (mounted once in the
 * root layout) draws a bottom sheet and a text dialog with the app's own theme.
 */
export interface SheetOptions {
  title?: string;
  message?: string;
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number;
}

interface SheetState extends SheetOptions {
  onSelect: (index: number) => void;
}

interface PromptState {
  title: string;
  message?: string;
  defaultValue: string;
  /** the text is hidden as it is typed (a secret key) */
  secure?: boolean;
  onSubmit: (value: string) => void;
}

export interface AppAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AppAlertOptions {
  title: string;
  message?: string;
  /** a small icon above the title */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** default: one "OK" button */
  buttons?: AppAlertButton[];
  /** may the card be closed by tapping outside it or with the back button? default: yes */
  dismissable?: boolean;
}

const useDialogs = create<{ sheet: SheetState | null; prompt: PromptState | null; alert: AppAlertOptions | null }>(() => ({ sheet: null, prompt: null, alert: null }));

/**
 * A message card in the app's own look, the same on both platforms (instead of the system Alert).
 * The last button is the main one unless it is marked "cancel".
 */
export function showAppAlert(opts: AppAlertOptions): void {
  useDialogs.setState({ alert: opts });
}

/** the menu that slides up from the bottom – the app's own card on both platforms (not the system sheet) */
export function showActionSheet(opts: SheetOptions, onSelect: (index: number) => void): void {
  useDialogs.setState({ sheet: { ...opts, onSelect } });
}

export function promptText(title: string, message: string | undefined, defaultValue: string, onSubmit: (value: string) => void): void {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, message, (text) => onSubmit(text ?? ''), 'plain-text', defaultValue);
    return;
  }
  useDialogs.setState({ prompt: { title, message, defaultValue, onSubmit } });
}

/** like promptText, for a secret: the letters are hidden, and nothing is suggested or remembered */
export function promptSecret(title: string, message: string | undefined, onSubmit: (value: string) => void): void {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, message, (text) => onSubmit(text ?? ''), 'secure-text');
    return;
  }
  useDialogs.setState({ prompt: { title, message, defaultValue: '', secure: true, onSubmit } });
}

function Sheet({ sheet }: { sheet: SheetState }) {
  useScheme();
  const close = () => useDialogs.setState({ sheet: null });
  const cancel = sheet.cancelButtonIndex;
  const options = sheet.options.map((label, i) => ({ label, i })).filter(({ i }) => i !== cancel);
  return (
    <Modal transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => undefined}
          style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingBottom: 30, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 }} />
          {(sheet.title || sheet.message) && (
            <View style={{ paddingHorizontal: 22, paddingBottom: 12, gap: 3 }}>
              {!!sheet.title && <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }} numberOfLines={1}>{sheet.title}</Text>}
              {!!sheet.message && <Text style={{ color: colors.sub, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{sheet.message}</Text>}
            </View>
          )}
          <View style={{ marginHorizontal: 12, borderRadius: 16, backgroundColor: colors.bg, overflow: 'hidden' }}>
            {options.map(({ label, i }, n) => (
              <Pressable
                key={`${i}-${label}`}
                onPress={() => {
                  close();
                  sheet.onSelect(i);
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 18,
                  paddingVertical: 16,
                  backgroundColor: pressed ? colors.surface2 : 'transparent',
                  borderTopWidth: n === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                })}
              >
                <Text style={{ color: i === sheet.destructiveButtonIndex ? colors.danger : colors.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {cancel !== undefined && (
            <Pressable onPress={close} style={({ pressed }) => ({ marginHorizontal: 12, marginTop: 10, paddingVertical: 15, borderRadius: 16, backgroundColor: pressed ? colors.border : colors.bg, alignItems: 'center' })}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{sheet.options[cancel]}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PromptDialog({ prompt }: { prompt: PromptState }) {
  useScheme();
  const [text, setText] = useState(prompt.defaultValue);
  const close = () => useDialogs.setState({ prompt: null });
  return (
    <Modal transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{prompt.title}</Text>
          {!!prompt.message && <Text style={{ color: colors.sub }}>{prompt.message}</Text>}
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus={!prompt.secure}
            secureTextEntry={prompt.secure}
            autoCapitalize={prompt.secure ? 'none' : undefined}
            autoCorrect={prompt.secure ? false : undefined}
            style={{ color: colors.text, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Pressable onPress={close} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={{ color: colors.sub, fontWeight: '700' }}>キャンセル</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                close();
                prompt.onSubmit(text);
              }}
              style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18, backgroundColor: colors.accent }}
            >
              <Text style={{ color: colors.onAccent, fontWeight: '800' }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AppAlert({ alert }: { alert: AppAlertOptions }) {
  useScheme();
  const buttons = alert.buttons ?? [{ text: 'OK' }];
  const dismissable = alert.dismissable ?? true;
  const close = () => useDialogs.setState({ alert: null });
  const press = (b: AppAlertButton) => {
    close();
    b.onPress?.();
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={dismissable ? close : undefined} statusBarTranslucent>
      <Pressable onPress={dismissable ? close : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderRadius: 22, padding: 22, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
          {!!alert.icon && (
            <View style={{ alignSelf: 'center', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 }}>
              <Ionicons name={alert.icon} size={26} color={colors.accentText} />
            </View>
          )}
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, textAlign: 'center' }}>{alert.title}</Text>
          {!!alert.message && (
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <Text selectable style={{ color: colors.sub, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{alert.message}</Text>
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            {buttons.map((b, i) => {
              const main = b.style !== 'cancel' && (b.style === 'destructive' || i === buttons.length - 1);
              const bg = main && b.style !== 'destructive' ? colors.accent : colors.surface2;
              const fg = main && b.style !== 'destructive' ? colors.onAccent : b.style === 'destructive' ? colors.danger : colors.text;
              return (
                <Pressable key={`${i}-${b.text}`} onPress={() => press(b)} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 16, backgroundColor: pressed ? colors.border : bg })}>
                  <Text style={{ color: fg, fontWeight: '800', fontSize: 15 }}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Mount once, near the root. Renders nothing until a dialog is requested. */
export function DialogHost() {
  const sheet = useDialogs((s) => s.sheet);
  const prompt = useDialogs((s) => s.prompt);
  const alert = useDialogs((s) => s.alert);
  return (
    <>
      {sheet && <Sheet sheet={sheet} />}
      {prompt && <PromptDialog prompt={prompt} />}
      {alert && <AppAlert alert={alert} />}
    </>
  );
}
