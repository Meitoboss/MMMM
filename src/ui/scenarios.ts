import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** the シナリオ chips on the 気分 tab (two rows that slide together), each with its icon */
export const SCENARIO_ROWS: { label: string; icon: IconName }[][] = [
  [
    { label: 'お気に入り', icon: 'heart' },
    { label: '作成', icon: 'create-outline' },
    { label: 'カラーノイズ', icon: 'color-palette-outline' },
    { label: '目覚め', icon: 'sunny-outline' },
    { label: '深い眠り', icon: 'moon-outline' },
    { label: 'ASMR', icon: 'ear-outline' },
    { label: 'ストレス解消', icon: 'leaf-outline' },
    { label: '夜のリセット', icon: 'time-outline' },
    { label: '瞑想', icon: 'ellipse-outline' },
    { label: '耳鳴り緩和', icon: 'ear-outline' },
    { label: '423hz スリープ', icon: 'bed-outline' },
  ],
  [
    { label: 'ADHD緩和', icon: 'radio-button-off-outline' },
    { label: '8Dオーディオ', icon: 'headset-outline' },
    { label: '528hz リラックス', icon: 'sparkles-outline' },
    { label: 'ディープワーク', icon: 'hardware-chip-outline' },
    { label: '考えすぎをやめる', icon: 'cloudy-outline' },
    { label: 'パワーナップ', icon: 'flash-outline' },
    { label: 'ディープフロー状態', icon: 'pulse-outline' },
    { label: '家事', icon: 'home-outline' },
    { label: '赤ちゃんのための睡眠', icon: 'happy-outline' },
  ],
];

/** the short line under the title of a シナリオ screen */
export const SCENARIO_SUBTITLE: Record<string, string> = {
  'ディープフロー状態': 'シータ波（4-7Hz）で深いフロー状態へ。',
};

/** the icon of a シナリオ, from its name (the one on its chip) */
export const scenarioIcon = (label: string): IconName | undefined => SCENARIO_ROWS.flat().find((c) => c.label === label)?.icon;
