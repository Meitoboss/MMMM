import type { ImageSourcePropType } from 'react-native';

/** the photo of each 集中 sound (the card, the mini bar and the player use it) */
const IMAGES: Record<string, ImageSourcePropType> = {
  focus_loop: require('../../assets/focus/broad_field.jpg'),
  moon_light: require('../../assets/focus/moon_light.jpg'),
};

export const focusImage = (key: string): ImageSourcePropType | undefined => IMAGES[key];

/** the text of the description of a 集中 sound, as shown under the player */
export interface FocusInfo {
  /** the one line under the title on the player */
  short: string;
  text: string;
  features: { icon: 'locate-outline' | 'git-network-outline' | 'extension-puzzle-outline' | 'flash-outline' | 'moon-outline' | 'bed-outline' | 'leaf-outline' | 'water-outline'; label: string }[];
  body: string;
}

export const FOCUS_INFO: Record<string, FocusInfo> = {
  focus_loop: {
    short: '邪魔されないディープワークと勉強の状態を構築するための広がりのある構造的なトーン。',
    text: '集中した思考や覚醒に関連する、活発な脳波のパターンです。考えを分析したり、日常の問題を解決したりする際の心の働きを反映します。',
    features: [
      { icon: 'locate-outline', label: '能動的な集中' },
      { icon: 'git-network-outline', label: '分析的思考' },
      { icon: 'extension-puzzle-outline', label: '問題解決' },
      { icon: 'flash-outline', label: '覚醒' },
    ],
    body: '半乾燥の荒野が日光の下に広がり、金色の草と疎らな木々が遠くの山頂に向かって伸びています。空気は開放的で明るくやや乾燥し、自然な秩序と乱されない明晰さを運びます。このトラックはベータ波スペクトル内の20Hzで動作し、目標指向の構造化された認知に合致しています。',
  },
  moon_light: {
    short: '月明りの水面の思索のためのきらめくアンビエントトーン。',
    text: '深く、夢を見ない睡眠に関連する、ゆっくりとした脳波のパターンです。外の世界への意識が薄れ、静かな休息へと移っていきます。',
    features: [
      { icon: 'moon-outline', label: '深い睡眠' },
      { icon: 'bed-outline', label: '深い休息' },
      { icon: 'leaf-outline', label: 'くつろぎ' },
      { icon: 'water-outline', label: '静かな心' },
    ],
    body: '広大な海の上を巨大な満月の下で漂うシーンです。6Hz周波数は集中した集中力に関連しており、心に広がる思考を解放する前にクリアにする助けとなります。',
  },
};
