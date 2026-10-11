import { useRef, useState } from 'react';
import { View } from 'react-native';

import { THUMB, fillWidth, thumbLeft, valueAtX } from '../core/seekBarMath';

/**
 * The app's own seek bar (used on Android, where the native slider did not react to touches at all).
 * It takes the touch at the moment the finger lands and does not give it up – nothing above it (the swipe that closes the screen)
 * can take it away – and works out the position from where the finger is inside the bar. The coloured part and the thumb are
 * drawn from `value`, which the screen keeps following the finger while it drags.
 *
 * onStart: the finger landed (the position it means). onChange: it moved. onComplete: it was lifted. onCancel: the system took the touch.
 */
export interface SeekBarProps {
  value: number;
  max: number;
  onStart: (value: number) => void;
  onChange: (value: number) => void;
  onComplete: (value: number) => void;
  onCancel: () => void;
  trackColor: string;
  fillColor: string;
  thumbColor: string;
  testID?: string;
  /** a line for the on-screen log (when "再生ログを表示" is on) */
  report?: (line: string) => void;
}

const HEIGHT = 40;

export function SeekBar(p: SeekBarProps) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const touching = useRef(false);
  const at = (e: { nativeEvent: { locationX: number } }) => valueAtX(e.nativeEvent.locationX, widthRef.current, p.max);
  return (
    <View
      testID={p.testID}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: Math.round(p.max), now: Math.round(p.value) }}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        const v = at(e);
        touching.current = true;
        p.report?.(`seekbar: touch x=${Math.round(e.nativeEvent.locationX)} of ${Math.round(widthRef.current)} -> ${v.toFixed(1)}s`);
        p.onStart(v);
      }}
      onResponderMove={(e) => {
        if (touching.current) p.onChange(at(e));
      }}
      onResponderRelease={(e) => {
        if (!touching.current) return;
        touching.current = false;
        const v = at(e);
        p.report?.(`seekbar: lifted -> ${v.toFixed(1)}s`);
        p.onComplete(v);
      }}
      onResponderTerminate={() => {
        if (!touching.current) return;
        touching.current = false;
        p.report?.('seekbar: touch taken away (no seek)');
        p.onCancel();
      }}
      style={{ height: HEIGHT, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: p.trackColor }}>
        <View style={{ width: fillWidth(p.value, p.max, width), height: 4, borderRadius: 2, backgroundColor: p.fillColor }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: (HEIGHT - THUMB) / 2, left: thumbLeft(p.value, p.max, width), width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.thumbColor }} />
    </View>
  );
}
