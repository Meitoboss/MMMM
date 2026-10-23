import type { ImageSourcePropType } from 'react-native';

/** the photo of each 集中 sound (the card, the mini bar and the player use it) */
const IMAGES: Record<string, ImageSourcePropType> = {
  focus_loop: require('../../assets/focus/broad_field.jpg'),
  moon_light: require('../../assets/focus/moon_light.jpg'),
  rain: require('../../assets/focus/rain.jpg'),
  sunset_flow: require('../../assets/focus/sunset_flow.jpg'),
  light: require('../../assets/focus/light.jpg'),
  moon_window: require('../../assets/focus/moon_window.jpg'),
  night_rain: require('../../assets/focus/night_rain.jpg'),
  morning_mist: require('../../assets/focus/morning_mist.jpg'),
};

export const focusImage = (key: string): ImageSourcePropType | undefined => IMAGES[key];

/** the text of the description of a 集中 sound, as shown under the player */
export interface FocusInfo {
  /** the one line under the title on the player */
  short: string;
  text: string;
  features: { icon: 'locate-outline' | 'git-network-outline' | 'extension-puzzle-outline' | 'flash-outline' | 'moon-outline' | 'bed-outline' | 'leaf-outline' | 'water-outline' | 'ellipse-outline' | 'sparkles-outline' | 'eye-outline' | 'time-outline' | 'person-outline'; label: string }[];
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
  morning_mist: {
    short: '穏やかで霧のかかった朝のためのジェントルなサウンドスケープ。',
    text: 'リラックスしながらも目覚めている状態に関連する、落ち着いた脳波のパターンです。積極的に考える負担から離れ、穏やかな注意を保つ状態を表します。',
    features: [
      { icon: 'water-outline', label: '穏やかな心' },
      { icon: 'ellipse-outline', label: '穏やかな集中' },
      { icon: 'time-outline', label: '今この瞬間' },
      { icon: 'person-outline', label: 'リラックスした気づき' },
    ],
    body: '夜明け前の霧に覆われた湖に面した障子の部屋です。このセッションの10Hz周波数はアルファ波の誘導を助け、心が穏やかで明晰で受容的な「フロー状態」を作り出します。',
  },
  night_rain: {
    short: '幽玄なアンダートーンのアンビエント子守唄。',
    text: '深いリラックスや内面への気づきに関連する、穏やかな脳波のパターンです。瞑想や想像、自由に漂う思考の内省的な感覚を思わせます。',
    features: [
      { icon: 'leaf-outline', label: '深いリラックス' },
      { icon: 'ellipse-outline', label: '瞑想' },
      { icon: 'sparkles-outline', label: '創造性' },
      { icon: 'eye-outline', label: '内面の振り返り' },
    ],
    body: '真夜中の薄暗い通りが安定した穏やかな雨に柔らかくされています。この音響環境は脳にシータ波（4-7Hz）を誘導するよう設計されており、深いリラクゼーション状態を促進します。',
  },
  moon_window: {
    short: '天空の窓の中で、深く夢のない眠りへと導く、静かで包み込むような音色。',
    text: '深く、夢を見ない睡眠に関連する、ゆっくりとした脳波のパターンです。外の世界への意識が薄れ、静かな休息へと移っていきます。',
    features: [
      { icon: 'moon-outline', label: '深い睡眠' },
      { icon: 'bed-outline', label: '深い休息' },
      { icon: 'leaf-outline', label: 'くつろぎ' },
      { icon: 'water-outline', label: '静かな心' },
    ],
    body: '深い青の夜空の中央に、細い三日月が浮かび、いくつかの星がそれを取り囲みます。周囲では分厚く渦巻く雲が円形の額縁をかたちづくり、その縁は隠された光に照らされて温かなオレンジとピンクに輝きます――まるで天に窓が開いたかのようです。このトラックは1Hzのデルタ波周波数に基づいており、夢を見ない深い眠りの状態と直接共鳴します。これは細胞の修復、エネルギーのリセット、免疫力の強化に不可欠な段階です。',
  },
  sunset_flow: {
    short: '暖かい夕暮れの中で深い集中を始めるための穏やかで没入的なトーン。',
    text: '集中した思考や覚醒に関連する、活発な脳波のパターンです。考えを分析したり、日常の問題を解決したりする際の心の働きを反映します。',
    features: [
      { icon: 'locate-outline', label: '能動的な集中' },
      { icon: 'git-network-outline', label: '分析的思考' },
      { icon: 'extension-puzzle-outline', label: '問題解決' },
      { icon: 'flash-outline', label: '覚醒' },
    ],
    body: '夕暮れの光が柔らかく温かな輝きで部屋を包みます。このトラックは16Hzのベータ波周波数を使用し、高い集中力と活発な認知の状態に直接対応します。精神的な明晰さを研ぎ澄まし、情報処理を加速し、深く没入した「フロー状態」へと心を導きます。',
  },
  rain: {
    short: '安定した雨の居心地のよいサウンドスケープ。',
    text: '深いリラックスや内面への気づきに関連する、穏やかな脳波のパターンです。瞑想や想像、自由に漂う思考の内省的な感覚を思わせます。',
    features: [
      { icon: 'leaf-outline', label: '深いリラックス' },
      { icon: 'ellipse-outline', label: '瞑想' },
      { icon: 'sparkles-outline', label: '創造性' },
      { icon: 'eye-outline', label: '内面の振り返り' },
    ],
    body: 'ブリキ屋根に安定した雨の柔らかく金属的な音が部屋を満たしています。このセッションの5Hz周波数はシータ波の誘導を助け、深いリラクゼーション瞑想に理想的な脳の状態です。',
  },
  light: {
    short: 'きらめくダストの心地よいアンビエントサウンド',
    text: 'リラックスしながらも目覚めている状態に関連する、落ち着いた脳波のパターンです。積極的に考える負担から離れ、穏やかな注意を保つ状態を表します。',
    features: [
      { icon: 'water-outline', label: '穏やかな心' },
      { icon: 'ellipse-outline', label: '穏やかな集中' },
      { icon: 'time-outline', label: '今この瞬間' },
      { icon: 'person-outline', label: 'リラックスした気づき' },
    ],
    body: '温かく太陽の光が差す森の中、完全に静かです。8Hz周波数はシータ波の誘導を助け、深いリラクゼーションと内省に理想的です。',
  },
};
