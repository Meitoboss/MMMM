import { ActionSheetIOS, Alert, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
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

const useDialogs = create<{ sheet: SheetState | null; prompt: PromptState | null }>(() => ({ sheet: null, prompt: null }));

export function showActionSheet(opts: SheetOptions, onSelect: (index: number) => void): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(opts, onSelect);
    return;
  }
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
  return (
    <Modal transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => undefined}
          style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: 24, borderWidth: 1, borderColor: colors.border }}
        >
          {(sheet.title || sheet.message) && (
            <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {!!sheet.title && <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{sheet.title}</Text>}
              {!!sheet.message && <Text style={{ color: colors.sub, marginTop: 2 }} numberOfLines={1}>{sheet.message}</Text>}
            </View>
          )}
          {sheet.options.map((label, i) =>
            i === cancel ? null : (
              <Pressable
                key={`${i}-${label}`}
                onPress={() => {
                  close();
                  sheet.onSelect(i);
                }}
                style={({ pressed }) => ({ paddingHorizontal: 20, paddingVertical: 15, backgroundColor: pressed ? colors.surface2 : 'transparent' })}
              >
                <Text style={{ color: i === sheet.destructiveButtonIndex ? colors.danger : colors.text, fontSize: 16 }}>{label}</Text>
              </Pressable>
            ),
          )}
          {cancel !== undefined && (
            <Pressable onPress={close} style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{sheet.options[cancel]}</Text>
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

/** Mount once, near the root. Renders nothing until a dialog is requested (Android only). */
export function DialogHost() {
  const sheet = useDialogs((s) => s.sheet);
  const prompt = useDialogs((s) => s.prompt);
  return (
    <>
      {sheet && <Sheet sheet={sheet} />}
      {prompt && <PromptDialog prompt={prompt} />}
    </>
  );
}
