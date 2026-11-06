/**
 * tuning.js — 世界の音楽に合わせる設定：基準の高さ・音名の表し方・主音・四分音
 *
 * 光背は「1周で1オクターブ」の螺旋なので、どの国の音楽の音も、高さそのものは同じように描けます。
 * ちがうのは「どう呼ぶか」と「どこを基準にするか」です。このファイルは、その決まりだけを受け持ちます
 * （画面にもマイクにも触らないので、Node.js だけでテストできます）。
 *
 *   基準の高さ  … ラ（A4）を何 Hz にするか。440 Hz が国際的な標準。オーケストラは 442・443 Hz、
 *                 バロック音楽は 415 Hz など、地域や時代でちがいます
 *   音名の表し方 … ドレミ・C D E・ドイツ式（H）・ラテン式（Do Re Mi）・移動ド・インドのサルガム・数字譜
 *   主音        … 12時に置く音。インドのサ（Sa）や、曲の主音を真上に置くと、音階の形が見やすい
 *   四分音      … 半音の半分。アラブ・トルコ・ペルシャの音楽で使う「半音より細かい音」の名前を出す
 *
 * 光背の中では、高さは「ラ＝440 Hz を 69 とする MIDI 番号」で持ちます。基準の高さは、
 * 名前を付けるときと、螺旋のどこを1周の始まりにするかを決めるときにだけ使います。
 */
import { freqToMidi, midiToFreq, NOTE_EN } from './dsp.js';
import { LANG } from './i18n.js';

const mod12 = (n) => ((Math.round(n) % 12) + 12) % 12;

/**
 * 音名の表し方。names は主音（relative のとき）またはド（C）から半音ずつ12個。
 * accidental は「♯・♭の付く音」（光背のまわりでは小さな点にする音）。
 */
export const NAMINGS = {
  ja: {
    names: ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'],
    title: { ja: 'ドレミ（日本）', en: 'Do Re Mi in kana (Japan)' },
    where: { ja: '日本の学校・楽器店で使う呼び方。ドがいつも C', en: 'Used in Japanese schools. Do is always C' },
  },
  en: {
    names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
    title: { ja: 'C D E（英語圏）', en: 'C D E (English)' },
    where: { ja: 'アメリカ・イギリスなど。コード名もこの文字', en: 'English-speaking countries; chord names use these letters' },
  },
  de: {
    names: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'],
    accidental: [1, 3, 6, 8, 10],
    title: { ja: 'C D E … H（ドイツ式）', en: 'C D E … H (German)' },
    where: {
      ja: 'ドイツ・オーストリア・北欧・東欧など。シは H、シ♭が B。♯は -is（Fis）',
      en: 'Germany, Austria, Nordic and Eastern Europe. B is H, B♭ is B, sharps end in -is (Fis)',
    },
  },
  solfege: {
    names: ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
    title: { ja: 'Do Re Mi（固定ド・ラテン式）', en: 'Do Re Mi (fixed do)' },
    where: {
      ja: 'フランス・イタリア・スペイン・ポルトガル・中南米・ロシアなど。Do がいつも C',
      en: 'France, Italy, Spain, Portugal, Latin America, Russia… Do is always C',
    },
  },
  movable: {
    relative: true,
    names: { ja: ['ド', 'ド♯', 'レ', 'ミ♭', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ラ♭', 'ラ', 'シ♭', 'シ'], en: ['Do', 'Di', 'Re', 'Me', 'Mi', 'Fa', 'Fi', 'Sol', 'Le', 'La', 'Te', 'Ti'] },
    accidental: [1, 3, 6, 8, 10],
    title: { ja: '移動ド（主音がド）', en: 'Movable do (tonic is Do)' },
    where: {
      ja: '主音をドと呼ぶ。合唱や音楽の授業、コダーイ・メソッドなど。調が変わっても階名は同じ',
      en: 'The tonic is always Do. Choirs, ear training, the Kodály method',
    },
  },
  sargam: {
    relative: true,
    names: ['Sa', 're', 'Re', 'ga', 'Ga', 'Ma', 'Ma′', 'Pa', 'dha', 'Dha', 'ni', 'Ni'],
    accidental: [1, 3, 6, 8, 10],
    title: { ja: 'Sa Re Ga（インドのサルガム）', en: 'Sa Re Ga (Indian sargam)' },
    where: {
      ja: 'インド・パキスタン・ネパールなど。主音がサ（Sa）。小文字は低めの音（コーマル）、Ma′ は高めのマ（ティーヴラ）',
      en: 'India, Pakistan, Nepal… The tonic is Sa. Lower case = komal (flat), Ma′ = tivra (sharp)',
    },
  },
  jianpu: {
    relative: true,
    names: ['1', '♯1', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'],
    accidental: [1, 3, 6, 8, 10],
    title: { ja: '1 2 3（数字譜）', en: '1 2 3 (numbered notation)' },
    where: {
      ja: '中国・台湾・インドネシアなどの数字譜（簡譜）。主音が 1',
      en: 'Numbered notation (jianpu) in China, Taiwan, Indonesia… The tonic is 1',
    },
  },
};

/** 選べる基準の高さ [Hz]。415 はバロック音楽、432 は一部で好まれる高さ、442・443 は多くのオーケストラ、466 は古い教会の高さ */
export const A4_CHOICES = [415, 430, 432, 435, 438, 439, 440, 441, 442, 443, 444, 445, 446, 466];

export const DEFAULT_TUNING = Object.freeze({ a4: 440, tonic: 0, naming: LANG === 'en' ? 'en' : 'ja', quarter: false });

const state = { ...DEFAULT_TUNING };
const listeners = new Set();

/** いまの設定（読み取り用） */
export const tuning = {
  get a4() {
    return state.a4;
  },
  get tonic() {
    return state.tonic;
  },
  get naming() {
    return state.naming;
  },
  get quarter() {
    return state.quarter;
  },
};

/** 設定を変える。おかしな値は無視する。変わったら、知らせを受け取る係を呼ぶ */
export function setTuning(patch = {}) {
  const next = { ...state };
  if (Number.isFinite(patch.a4) && patch.a4 >= 380 && patch.a4 <= 500) next.a4 = patch.a4;
  if (Number.isFinite(patch.tonic)) next.tonic = mod12(patch.tonic);
  if (typeof patch.naming === 'string' && Object.hasOwn(NAMINGS, patch.naming)) next.naming = patch.naming;
  if (typeof patch.quarter === 'boolean') next.quarter = patch.quarter;
  const changed = Object.keys(next).some((k) => next[k] !== state[k]);
  Object.assign(state, next);
  if (changed) for (const fn of listeners) fn({ ...state });
  return changed;
}

export function onTuning(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** いまの音名の表し方は、主音から数えるもの（移動ド・サルガム・数字譜）か */
export const isRelative = () => !!NAMINGS[state.naming].relative;

function namesOf(naming) {
  const n = NAMINGS[naming].names;
  return Array.isArray(n) ? n : n[LANG] || n.ja;
}

/** 音名の番号（C=0 … B=11）の名前（主音から数える表し方では、主音からの度数で） */
export function pcName(pc) {
  const rel = isRelative() ? pc - state.tonic : pc;
  return namesOf(state.naming)[mod12(rel)];
}

/** ♯・♭の付く音か（光背のまわりでは小さな点にする） */
export function isAccidental(pc) {
  const n = NAMINGS[state.naming];
  const rel = mod12(isRelative() ? pc - state.tonic : pc);
  if (n.accidental) return n.accidental.includes(rel);
  return namesOf(state.naming)[rel].includes('♯');
}

/** 時計の何時の向きか（主音が12時。主音から時計回りに半音ずつ） */
export function hourOf(pc) {
  const h = mod12(pc - state.tonic);
  return h === 0 ? 12 : h;
}

/**
 * 螺旋のいちばん内側の音（MIDI 番号、基準の高さで数えたもの）。主音から始まり、
 * C2（約 65 Hz）から半オクターブ以内に収める（主音がどこでも、ほぼ同じ高さの範囲を描く）
 */
export function baseMidi(tonic = state.tonic) {
  return 36 + tonic - (tonic > 6 ? 12 : 0);
}

/**
 * 周波数を、いまの設定で読む。
 * @returns {{ midi:number, pc:number, cents:number, name:string, en:string, octave:number, hour:number, quarter:boolean, target:number }}
 *   midi は基準の高さで数えた（四分音のときは、上の）半音。cents はいちばん近い音（半音または四分音）からのずれ。
 *   target は、そのいちばん近い音のちょうどの周波数 [Hz]
 */
export function describe(hz) {
  if (!(hz > 0)) return null;
  const exact = freqToMidi(hz, state.a4);
  let step = Math.round(exact);
  let quarter = false;
  if (state.quarter) {
    const q = Math.round(exact * 2) / 2;
    if (q !== Math.round(q)) {
      quarter = true;
      step = Math.ceil(q); // 四分音は、上の音から「四分音低い」と呼ぶ（アラブ音楽の E♭‿ などと同じ向き）
    }
  }
  const center = quarter ? step - 0.5 : step;
  const pc = mod12(step);
  const octave = Math.floor(step / 12) - 1;
  const mark = quarter ? '−¼' : '';
  return {
    midi: step,
    pc,
    cents: Math.round((exact - center) * 100),
    name: pcName(pc) + mark,
    en: NOTE_EN[pc] + mark + octave,
    octave,
    hour: hourOf(pc),
    quarter,
    target: midiToFreq(center, state.a4),
  };
}

/** 基準の高さで数えた MIDI 番号 → 鳴らす周波数 */
export const midiHz = (m) => midiToFreq(m, state.a4);
