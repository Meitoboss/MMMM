import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';

import { moveItem, targetIndex } from '../core/reorder';
import { colors, useScheme } from './theme';

/**
 * A list whose rows can be re-ordered by dragging the handle (≡) – built only from React Native's own
 * PanResponder / Animated, so it needs no extra native module.
 *
 * All rows have the same height; they are positioned absolutely, which makes "which row am I over?" a division.
 * Put it inside a ScrollView and disable that ScrollView while `onDragChange(true)` is in effect.
 */
export interface DragRowInfo {
  index: number;
  dragging: boolean;
  /** the grip to put into the row – only this part starts a drag */
  handle: ReactNode;
}

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  renderRow: (item: T, info: DragRowInfo) => ReactNode;
  /** called after a drop that changed the order */
  onReorder: (key: string, from: number, to: number) => void;
  onDragChange?: (dragging: boolean) => void;
}

interface Api {
  begin: (key: string) => void;
  move: (key: string, dy: number) => void;
  end: (key: string) => void;
}

function Row({ k, api, height, y, dragging, children }: { k: string; api: React.MutableRefObject<Api>; height: number; y: Animated.Value; dragging: boolean; children: (handle: ReactNode) => ReactNode }) {
  useScheme();
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => api.current.begin(k),
        onPanResponderMove: (_e, g) => api.current.move(k, g.dy),
        onPanResponderRelease: () => api.current.end(k),
        onPanResponderTerminate: () => api.current.end(k),
      }),
    [k, api],
  );

  const handle = (
    <View {...pan.panHandlers} hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }} style={{ paddingHorizontal: 6, justifyContent: 'center' }}>
      <Ionicons name="reorder-three" size={26} color={dragging ? colors.accentText : colors.sub} />
    </View>
  );

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height,
        top: y,
        zIndex: dragging ? 10 : 0,
        backgroundColor: dragging ? colors.surface : 'transparent',
        shadowColor: '#000',
        shadowOpacity: dragging ? 0.3 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      {children(handle)}
    </Animated.View>
  );
}

export function DraggableList<T>({ items, keyOf, rowHeight, renderRow, onReorder, onDragChange }: Props<T>) {
  const [order, setOrder] = useState<readonly T[]>(items);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const ys = useRef(new Map<string, Animated.Value>()).current;
  const drag = useRef<{ key: string; from: number; current: number; base: readonly T[] } | null>(null);

  // the parent changed the list (added / removed / reloaded after a drop)
  useEffect(() => {
    if (!drag.current) setOrder(items);
  }, [items]);

  const yOf = (key: string, index: number): Animated.Value => {
    let v = ys.get(key);
    if (!v) {
      v = new Animated.Value(index * rowHeight);
      ys.set(key, v);
    }
    return v;
  };

  // every row (except the one being dragged) slides to its slot
  useEffect(() => {
    order.forEach((it, i) => {
      const k = keyOf(it);
      if (drag.current?.key === k) return;
      Animated.timing(yOf(k, i), { toValue: i * rowHeight, duration: 140, useNativeDriver: false }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, rowHeight]);

  const api = useRef<Api>({ begin: () => undefined, move: () => undefined, end: () => undefined });
  api.current = {
    begin: (key) => {
      const base = orderRef.current;
      const from = base.findIndex((it) => keyOf(it) === key);
      if (from < 0) return;
      drag.current = { key, from, current: from, base };
      yOf(key, from).stopAnimation();
      setDragKey(key);
      onDragChange?.(true);
    },
    move: (key, dy) => {
      const d = drag.current;
      if (!d || d.key !== key) return;
      const limit = (d.base.length - 1) * rowHeight;
      yOf(key, d.from).setValue(Math.max(0, Math.min(limit, d.from * rowHeight + dy)));
      const target = targetIndex(d.from, dy, rowHeight, d.base.length);
      if (target !== d.current) {
        d.current = target;
        setOrder(moveItem(d.base, d.from, target));
      }
    },
    end: (key) => {
      const d = drag.current;
      if (!d || d.key !== key) return;
      drag.current = null;
      setDragKey(null);
      onDragChange?.(false);
      Animated.timing(yOf(key, d.current), { toValue: d.current * rowHeight, duration: 120, useNativeDriver: false }).start();
      if (d.current !== d.from) onReorder(key, d.from, d.current);
    },
  };

  return (
    <View style={{ height: order.length * rowHeight }}>
      {order.map((item, index) => {
        const k = keyOf(item);
        return (
          <Row key={k} k={k} api={api} height={rowHeight} y={yOf(k, index)} dragging={dragKey === k}>
            {(handle) => renderRow(item, { index, dragging: dragKey === k, handle })}
          </Row>
        );
      })}
    </View>
  );
}
