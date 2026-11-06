/**
 * kouhai.js — 光背（こうはい）：音を、仏さまの後ろの「光の輪」のような螺旋で観る
 *
 * 仏像の後ろには、光を表す輪（光背）があります。この見方では、音の高さを
 *   - 向き  … 時計の文字盤と同じ。12時がド、時計回りに半音ずつ（1時がド♯、2時がレ…11時がシ）
 *   - 距離  … 内側ほど低く、外側ほど高い。螺旋（らせん）を1周すると、ちょうど1オクターブ上がる
 * のように並べ、螺旋から外へ伸びる「千本の光（千手）」の長さと色で、その高さの強さを表します。
 *
 * 1オクターブ違いの同じ音名（440 Hz と 880 Hz のラ）は、同じ向きに並びます。
 * だから倍音（2倍・3倍…）や和音（ドミソ）が「形」として見えます。
 *
 * 朱色の光は「今の高さ」。2つの淡い光が、同じ道すじを少し遅れて追いかけます（カノン＝輪唱）。
 */
import { midiToFreq, freqToMidi } from './dsp.js';
import { L } from './i18n.js';
import { tuning, baseMidi, pcName, isAccidental, hourOf } from './tuning.js';
import { parseColor } from './colormap.js';

export const ARM_COUNT = 1000; // 千手観音の「千」
export const KOUHAI_LOW_MIDI = 36; // いちばん内側：ド C2（約 65 Hz）
export const KOUHAI_OCTAVES = 7; // C2〜C9（約 8,400 Hz）。7周
export const KOUHAI_FMIN = midiToFreq(KOUHAI_LOW_MIDI);
export const KOUHAI_HIGH_MIDI = KOUHAI_LOW_MIDI + 12 * KOUHAI_OCTAVES; // いちばん外側：ド C9

/**
 * いまの螺旋の始まり（tuning.js の主音と基準の高さで決まる）。上の KOUHAI_* は、主音がド・ラ＝440 Hz のときの値。
 * 主音を変えると、その音が12時に来て、1周が「主音から次の主音まで」になる
 */
let lowMidi = KOUHAI_LOW_MIDI;
let fMin = KOUHAI_FMIN;

/** 螺旋の始まりを、いまの主音と基準の高さに合わせる（設定が変わったら呼ぶ） */
export function syncSpiral() {
  lowMidi = baseMidi(tuning.tonic);
  fMin = midiToFreq(lowMidi, tuning.a4);
  return { lowMidi, fMin };
}

/**
 * 観察窓（AnalyserNode）が音を分ける細かさ（FFT の点の数）。
 * 光背は内側ほど低い音で、低い音ほど1つの区分（約 48000 ÷ 点の数 Hz）が何半音にもまたがる。
 * 4096 点ではド4（262 Hz）のあたりで1区分が約 0.8 半音になり、光が扇のように広がって和音の形がぼやける。
 * 16384 点なら約 0.2 半音（そのかわり、1回に約 0.34 秒ぶんの音を見るので、光の動きは少しゆっくり）。
 */
export const KOUHAI_FFT_SIZE = 16384;

/**
 * 速い観察窓の細かさ。4096 点なら 1回に見る音は約 0.085 秒（16384 点の 1/4）なので、光が4倍速く動く。
 * そのかわり1区分は約 11.7 Hz と粗いので、半音の幅が区分3つ分より広くなる高い音（約 400 Hz より上）だけに使う。
 * 低い音は細かい観察窓、高い音は速い観察窓、そのあいだ（約 400〜800 Hz）は2つを少しずつ混ぜて、つなぎ目を見せない。
 */
export const KOUHAI_FAST_FFT_SIZE = 4096;
export const FAST_FROM_HZ = 400;
export const FAST_FULL_HZ = 800;

/** 周波数 f の光を、どれだけ速い観察窓で描くか（0：細かい窓だけ 〜 1：速い窓だけ） */
export function fastWeight(f) {
  if (!(f > FAST_FROM_HZ)) return 0;
  if (f >= FAST_FULL_HZ) return 1;
  return Math.log2(f / FAST_FROM_HZ) / Math.log2(FAST_FULL_HZ / FAST_FROM_HZ);
}

/**
 * 千本の光それぞれの大きさ [dB] を、細かい窓（slow）と速い窓（fast）から求めて out に入れる。いちばん大きい値を返す。
 * fast がなければ（止めた絵・例の絵など）、細かい窓だけで求める。
 */
export function armLevels(slow, fast, maps, out) {
  let top = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const w = fast && maps.fast ? maps.weight[i] : 0;
    let v = w < 1 ? readArm(slow, maps.slow, i) : 0;
    if (w > 0) v = v * (1 - w) + readArm(fast, maps.fast, i) * w;
    out[i] = v;
    if (v > top) top = v;
  }
  return top;
}

function readArm(db, { mode, a, b, frac }, i) {
  if (mode[i] === 0) {
    const j = a[i];
    return db[j] + (db[j + 1] - db[j]) * frac[i];
  }
  let v = -Infinity;
  for (let k = a[i]; k <= b[i]; k++) if (db[k] > v) v = db[k];
  return v;
}

/** 音名の番号（ド=0 … シ=11）→ 時計の何時の向きか。12個の音名が、文字盤の12の時刻にちょうど重なる（主音が12時） */
export function clockOf(pitchClass) {
  return hourOf(pitchClass);
}

/** MIDI 番号（基準の高さで数えたもの）→ 内側から数えて何周目か（1〜7。主音がドなら C2〜B2 が 1周目） */
export function ringOf(midi) {
  return Math.min(KOUHAI_OCTAVES, Math.max(1, Math.floor((midi - lowMidi) / 12) + 1));
}

/** 光背の中の高さ（ラ＝440 Hz で数えた MIDI 番号）→ 螺旋の何周目か */
export function midiToTurn(m) {
  return freqToTurn(midiToFreq(m));
}


/** 円の直径を 1 としたときの、螺旋の内側・外側、音名の文字、中心の輪の位置（半径） */
export const KOUHAI_GEOMETRY = { rIn: 0.135, rOut: 0.4, rLabel: 0.47, rCenter: 0.105 };

/** 周波数 → 螺旋の上で「何周目か」（0〜7。整数の所がド。小数の部分が向き） */
export function freqToTurn(f) {
  return Math.log2(f / fMin);
}

export function turnToFreq(turn) {
  return fMin * Math.pow(2, turn);
}

/**
 * 螺旋の上の点。size は円の直径。戻り値は円の中心からのずれ（x は右、y は下が正）。
 * 角度は12時（上）から時計回り：canvas は y が下向きなので、角度が増えると時計回りになる。
 */
export function spiralPoint(turn, size, g = KOUHAI_GEOMETRY) {
  const angle = -Math.PI / 2 + 2 * Math.PI * turn;
  const r = size * (g.rIn + ((g.rOut - g.rIn) * turn) / KOUHAI_OCTAVES);
  return { x: r * Math.cos(angle), y: r * Math.sin(angle), r, angle };
}

/** 画面の点（中心からのずれ dx, dy）にいちばん近い、螺旋の上の周波数（絵に触れて調べるため） */
export function pointToFreq(dx, dy, size, g = KOUHAI_GEOMETRY) {
  let frac = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI);
  frac -= Math.floor(frac); // 12時から時計回りに 0〜1
  const turns = ((Math.hypot(dx, dy) / size - g.rIn) / (g.rOut - g.rIn)) * KOUHAI_OCTAVES;
  const k = Math.round(turns - frac); // 何周目の螺旋に近いか
  return turnToFreq(Math.min(KOUHAI_OCTAVES, Math.max(0, k + frac)));
}

/** 画面の点にいちばん近い「半音」（基準の高さで数えた MIDI 番号の整数。螺旋の内側から外側まで）。指で鳴らすときは、この高さの音を鳴らす */
export function pointToMidi(dx, dy, size, g = KOUHAI_GEOMETRY) {
  const m = Math.round(freqToMidi(pointToFreq(dx, dy, size, g), tuning.a4));
  return Math.min(lowMidi + 12 * KOUHAI_OCTAVES, Math.max(lowMidi, m));
}

/**
 * 千本の光それぞれが、FFT のどのビン（周波数の区分）を受け持つかの表。
 * 1本の受け持ちがビン1つより狭いとき（低い音）は隣のビンと補間、広いとき（高い音）は範囲の最大値をとる。
 */
export function armBinMap(binHz, bins, count = ARM_COUNT) {
  const mode = new Uint8Array(count);
  const a = new Int32Array(count);
  const b = new Int32Array(count);
  const frac = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t0 = (i / count) * KOUHAI_OCTAVES;
    const t1 = ((i + 1) / count) * KOUHAI_OCTAVES;
    const kLo = turnToFreq(t0) / binHz;
    const kHi = turnToFreq(t1) / binHz;
    const k = turnToFreq((t0 + t1) / 2) / binHz;
    if (kHi - kLo < 1) {
      a[i] = Math.min(bins - 2, Math.max(0, Math.floor(k)));
      frac[i] = Math.min(1, Math.max(0, k - a[i]));
    } else {
      mode[i] = 1;
      a[i] = Math.max(0, Math.floor(kLo));
      b[i] = Math.min(bins - 1, Math.ceil(kHi));
    }
  }
  return { mode, a, b, frac };
}

/** 保存する画像・動画の下の帯に書く、アプリの場所（https:// は省く） */
const APP_URL_LABEL = 'fenom6.github.io/Halo';
const BUCKETS = 10; // 光を明るさで10組に分け、組ごとにまとめて描く（速く描くため）
const ORB_SIZE = [5.5, 4.5, 4]; // 3つの光の大きさ（今の高さ、追いかける光1、2）
const ORB_STRENGTH = [1, 0.62, 0.38];
const TRAIL = 24; // 光が残す軌跡の長さ（コマ数）。はじめの値。見た目の設定で変えられる（setTrail）

const rgbStr = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

/** canvas の画素数を、画面の表示サイズ × 画素密度に合わせる（くっきり表示のため） */
export function fitCanvas(canvas, maxDpr = 2) {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

/** 字と字のあいだを gap だけあけて、(x, y) を中心に書く（canvas の letterSpacing は使えない端末があるため） */
function spacedText(g, text, x, y, gap) {
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  const align = g.textAlign;
  g.textAlign = 'left';
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    g.fillText(c, cx, y);
    cx += widths[i] + gap;
  });
  g.textAlign = align;
}

export class KouhaiView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.base = document.createElement('canvas'); // 地と目盛り（変わらない部分）を描いておく裏の板
    this.opts = { minDb: -100, maxDb: -25 };
    this.binHz = 48000 / 4096;
    this.bins = 2048;
    this.map = null;
    this.lut = null;
    this.colors = { bg: [244, 245, 240], grid: [221, 225, 218], ink: [27, 32, 29], muted: [93, 101, 95], mark: [196, 71, 43], gold: [138, 101, 16] };
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.size = 0; // 円の直径（画素）
    this.sizeCss = 0; // 円の直径（CSS の px）
    this.orbs = [0, 1, 2].map(() => ({ turn: null, alpha: 0, trail: [] }));
    this.voiceColors = null; // カノンのときだけ、3つの声を色分けする（[第1声, 第2声, 第3声] の色）
    this.trailLen = TRAIL;
    this.rainbow = null; // 虹のとき：[12の向き][3段の明るさ] の色。null なら、強さで色を変える（金・朱・青・紫）
  }

  /** 3つの光が残す軌跡の長さ（コマ数） */
  setTrail(frames) {
    this.trailLen = Math.max(2, Math.round(frames) || TRAIL);
  }

  /** 虹（音名ごとの色）にする。table は look.js の rainbowTable()。null で、強さで色を変える描き方に戻す */
  setRainbow(table) {
    this.rainbow = table;
  }

  /** 3つの光を色分けする（カノンの3つの声）。null で、ふだんの「朱色の光と、淡い2つの光」に戻す */
  setVoiceColors(list) {
    this.voiceColors = list ? list.map((c) => parseColor(c)) : null;
  }

  setPalette(lut, colors) {
    this.lut = lut;
    for (const [k, v] of Object.entries(colors)) if (v) this.colors[k] = parseColor(v);
    this.paintBase();
  }

  configure({ sampleRate, fftSize, minDb, maxDb }) {
    if (sampleRate && fftSize) {
      this.binHz = sampleRate / fftSize;
      this.bins = fftSize / 2;
    }
    if (Number.isFinite(minDb)) this.opts.minDb = minDb;
    if (Number.isFinite(maxDb)) this.opts.maxDb = maxDb;
    this.map = armBinMap(this.binHz, this.bins);
    // 速い観察窓の表と、光ごとの混ぜ方（主音・基準の高さが変わると光の受け持つ高さが変わるので、ここで作り直す）
    const sr = this.binHz * this.bins * 2;
    this.fastMap = armBinMap(sr / KOUHAI_FAST_FFT_SIZE, KOUHAI_FAST_FFT_SIZE / 2);
    this.weight = new Float32Array(ARM_COUNT);
    for (let i = 0; i < ARM_COUNT; i++) this.weight[i] = fastWeight(turnToFreq(((i + 0.5) / ARM_COUNT) * KOUHAI_OCTAVES));
  }

  /** 画面の大きさに合わせる。円の直径（CSS の px）を返す。隠れているときは何もしない */
  resize() {
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return null;
    const { w, h, dpr } = fitCanvas(this.canvas);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.sizeCss = Math.max(80, Math.min(this.canvas.clientWidth, this.canvas.clientHeight) - 8);
    this.size = this.sizeCss * dpr;
    this.cx = w / 2;
    this.cy = h / 2;
    // 千本の光の、根もとの位置と向き
    this.cos = new Float32Array(ARM_COUNT);
    this.sin = new Float32Array(ARM_COUNT);
    this.root = new Float32Array(ARM_COUNT);
    for (let i = 0; i < ARM_COUNT; i++) {
      const p = spiralPoint(((i + 0.5) / ARM_COUNT) * KOUHAI_OCTAVES, this.size);
      this.cos[i] = Math.cos(p.angle);
      this.sin[i] = Math.sin(p.angle);
      this.root[i] = p.r;
    }
    const turnGap = (this.size * (KOUHAI_GEOMETRY.rOut - KOUHAI_GEOMETRY.rIn)) / KOUHAI_OCTAVES; // 螺旋の1周ぶんの間隔
    this.armMin = 0.6 * dpr;
    this.armMax = 2.4 * turnGap; // 大きい音の光は、外の周まで突き抜ける
    this.base.width = w;
    this.base.height = h;
    this.paintBase();
    this.clear();
    return { size: this.sizeCss };
  }

  /** 地と目盛り：外の輪、12本の筋（音名の向き）、螺旋の道すじ、中心の輪（頭光） */
  paintBase() {
    const { w, h, dpr, cx, cy, size, colors } = this;
    if (!w || !h) return;
    const g = this.base.getContext('2d');
    g.fillStyle = rgbStr(colors.bg);
    g.fillRect(0, 0, w, h);
    g.lineWidth = dpr;
    g.strokeStyle = rgbStr(colors.grid);
    g.beginPath();
    g.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
    g.stroke();
    // 四分音を名前で出すときは、半音のあいだ（30分の向き）にも細い筋を引く
    if (tuning.quarter) {
      g.strokeStyle = rgbStr(colors.grid, 0.7);
      for (let k = 0; k < 12; k++) {
        const ang = -Math.PI / 2 + ((k + 0.5) * Math.PI) / 6;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * size * (KOUHAI_GEOMETRY.rCenter + 0.02), cy + Math.sin(ang) * size * (KOUHAI_GEOMETRY.rCenter + 0.02));
        g.lineTo(cx + Math.cos(ang) * size * 0.42, cy + Math.sin(ang) * size * 0.42);
        g.stroke();
      }
    }
    for (let k = 0; k < 12; k++) {
      const natural = !isAccidental(tuning.tonic + k); // 12時から k 時の向きの音
      const ang = -Math.PI / 2 + (k * Math.PI) / 6;
      g.strokeStyle = rgbStr(natural ? colors.muted : colors.grid, natural ? 0.32 : 1);
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * size * KOUHAI_GEOMETRY.rCenter, cy + Math.sin(ang) * size * KOUHAI_GEOMETRY.rCenter);
      g.lineTo(cx + Math.cos(ang) * size * 0.43, cy + Math.sin(ang) * size * 0.43);
      g.stroke();
    }
    g.strokeStyle = rgbStr(colors.muted, 0.45);
    g.beginPath();
    const steps = KOUHAI_OCTAVES * 120;
    for (let i = 0; i <= steps; i++) {
      const p = spiralPoint((i / steps) * KOUHAI_OCTAVES, size);
      if (i) g.lineTo(cx + p.x, cy + p.y);
      else g.moveTo(cx + p.x, cy + p.y);
    }
    g.stroke();
    // 各オクターブの主音に小さな点（ここで1周）
    g.fillStyle = rgbStr(colors.muted);
    for (let k = 0; k <= KOUHAI_OCTAVES; k++) {
      const p = spiralPoint(k, size);
      g.beginPath();
      g.arc(cx + p.x, cy + p.y, 1.6 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = rgbStr(colors.muted, 0.6);
    g.beginPath();
    g.arc(cx, cy, size * KOUHAI_GEOMETRY.rCenter, 0, Math.PI * 2);
    g.stroke();
  }

  clear() {
    for (const o of this.orbs) {
      o.turn = null;
      o.alpha = 0;
      o.trail.length = 0;
    }
    if (this.w) this.ctx.drawImage(this.base, 0, 0);
  }

  /**
   * 1コマ描く。
   * @param {Float32Array} db 高さごとの大きさ [dB]（AnalyserNode と同じ形）
   * @param {Array<number|null>} voices 3つの光の高さ（MIDI 番号。小数でもよい）。null は「光なし」
   * @param {{dt?:number, still?:boolean, bass?:number|null, fast?:Float32Array|null}} o dt は前のコマからのミリ秒。still は止まっているときの描き直し。
   *   fast は速い観察窓（KOUHAI_FAST_FFT_SIZE 点）の dB の並び。あれば高い音の光をこちらで描く
   */
  draw(db, voices = [], { dt = 16, still = false, bass = null, fast = null } = {}) {
    if (!this.w || !this.lut || !this.map) return;
    const ctx = this.ctx;
    // 前のコマを少しずつ地の色へ戻す（残像）。止まっているときは、きれいに描き直す
    ctx.globalAlpha = still ? 1 : 1 - Math.pow(0.6, dt / 16.7);
    ctx.drawImage(this.base, 0, 0);
    ctx.globalAlpha = 1;
    if (still) for (const o of this.orbs) o.trail.length = 0;
    this.drawArms(db, fast);
    if (bass !== null && bass !== undefined) this.drawBass(bass);
    this.drawOrbs(voices, still ? 1e4 : dt);
  }

  drawArms(db, fast = null) {
    const { ctx, cx, cy, lut, dpr } = this;
    const { minDb, maxDb } = this.opts;
    const span = maxDb - minDb;
    const level = this.level || (this.level = new Float32Array(ARM_COUNT));
    const top = armLevels(db, fast, { slow: this.map, fast: this.fastMap, weight: this.weight }, level);
    // 色は「本当の大きさ」（スペクトログラムと同じ目盛り）、長さは「今いちばん強い成分から何 dB 下か」。
    // こうすると、1つの高さの音は1本の鋭い光になり、まわりへのにじみ（FFT の漏れ）は短く描かれる。
    // 静かなときは基準を下げすぎない（雑音が長い光にならないように）
    const ref = Math.max(top, minDb + 0.45 * span);
    const RANGE = 45;
    if (this.rainbow) {
      this.drawRainbow(level, ref, RANGE);
      return;
    }
    const paths = [];
    for (let k = 0; k < BUCKETS; k++) paths.push(new Path2D());
    for (let i = 0; i < ARM_COUNT; i++) {
      let u = (level[i] - minDb) / span;
      if (!(u > 0.04)) continue; // 小さすぎる（または数でない）成分は描かない
      if (u > 1) u = 1;
      const rel = (level[i] - (ref - RANGE)) / RANGE;
      const len = rel > 0 ? Math.pow(Math.min(1, rel), 2.2) : 0;
      const r0 = this.root[i];
      const r1 = r0 + this.armMin + this.armMax * len;
      const p = paths[Math.min(BUCKETS - 1, Math.floor(u * BUCKETS))];
      p.moveTo(cx + this.cos[i] * r0, cy + this.sin[i] * r0);
      p.lineTo(cx + this.cos[i] * r1, cy + this.sin[i] * r1);
    }
    for (let k = 0; k < BUCKETS; k++) {
      const idx = Math.round(255 * (0.2 + (0.8 * (k + 0.5)) / BUCKETS)) * 4;
      ctx.strokeStyle = `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`;
      ctx.lineWidth = dpr * (0.9 + (0.9 * k) / (BUCKETS - 1));
      ctx.stroke(paths[k]);
    }
  }

  /**
   * 虹：光の色を「向き（音名）」で決める。いちばん近い半音の向きの色にするので、同じ音名は何周目でも同じ色、
   * 和音は色の組み合わせになる。強さは、3段の明るさと太さで表す（12 × 3 組にまとめて描く）
   */
  drawRainbow(level, ref, RANGE) {
    const { ctx, cx, cy, dpr } = this;
    const { minDb, maxDb } = this.opts;
    const span = maxDb - minDb;
    const paths = Array.from({ length: 36 }, () => new Path2D());
    for (let i = 0; i < ARM_COUNT; i++) {
      let u = (level[i] - minDb) / span;
      if (!(u > 0.04)) continue;
      if (u > 1) u = 1;
      const rel = (level[i] - (ref - RANGE)) / RANGE;
      const len = rel > 0 ? Math.pow(Math.min(1, rel), 2.2) : 0;
      const r0 = this.root[i];
      const r1 = r0 + this.armMin + this.armMax * len;
      const frac = (((i + 0.5) / ARM_COUNT) * KOUHAI_OCTAVES) % 1; // 1周のうちのどこか（0 が12時）
      const dir = Math.round(frac * 12) % 12;
      const step = u < 0.45 ? 0 : u < 0.7 ? 1 : 2;
      const p = paths[dir * 3 + step];
      p.moveTo(cx + this.cos[i] * r0, cy + this.sin[i] * r0);
      p.lineTo(cx + this.cos[i] * r1, cy + this.sin[i] * r1);
    }
    for (let k = 0; k < 36; k++) {
      const step = k % 3;
      ctx.strokeStyle = this.rainbow[Math.floor(k / 3)][step];
      ctx.lineWidth = dpr * (0.9 + 0.45 * step);
      ctx.stroke(paths[k]);
    }
  }

  drawBass(midi) {
    const { ctx, cx, cy, dpr } = this;
    const turn = midiToTurn(midi);
    if (turn < 0 || turn > KOUHAI_OCTAVES) return;
    const p = spiralPoint(turn, this.size);
    ctx.strokeStyle = rgbStr(this.colors.gold, 0.85);
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(cx + p.x, cy + p.y, 8 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawOrbs(voices, dt) {
    const { ctx, cx, cy, dpr, colors } = this;
    const kPos = 1 - Math.exp(-dt / 70); // 位置のなめらかさ（すばやく、でも瞬間移動はしない）
    const kAlpha = 1 - Math.exp(-dt / 140);
    for (let v = this.orbs.length - 1; v >= 0; v--) {
      const o = this.orbs[v];
      const m = voices[v];
      const target = m === null || m === undefined ? null : midiToTurn(m);
      if (target !== null && target >= -0.25 && target <= KOUHAI_OCTAVES + 0.25) {
        o.turn = o.turn === null || o.alpha < 0.05 ? target : o.turn + (target - o.turn) * kPos;
        o.alpha += (1 - o.alpha) * kAlpha;
      } else {
        o.alpha -= o.alpha * kAlpha;
      }
      if (o.turn === null || o.alpha < 0.02) {
        o.trail.length = 0;
        continue;
      }
      const p = spiralPoint(Math.min(KOUHAI_OCTAVES, Math.max(0, o.turn)), this.size);
      const x = cx + p.x;
      const y = cy + p.y;
      o.trail.push(x, y);
      if (o.trail.length > this.trailLen * 2) o.trail.splice(0, o.trail.length - this.trailLen * 2);
      const color = this.voiceColors ? this.voiceColors[v] : colors.mark;
      const strength = (this.voiceColors ? 0.95 : ORB_STRENGTH[v]) * o.alpha;
      // 軌跡（古いほど淡く、細く）
      ctx.strokeStyle = rgbStr(color);
      ctx.lineCap = 'round';
      for (let i = 2; i < o.trail.length; i += 2) {
        const age = i / o.trail.length;
        ctx.globalAlpha = strength * 0.55 * age;
        ctx.lineWidth = dpr * (0.6 + 1.8 * age);
        ctx.beginPath();
        ctx.moveTo(o.trail[i - 2], o.trail[i - 1]);
        ctx.lineTo(o.trail[i], o.trail[i + 1]);
        ctx.stroke();
      }
      // 光：まわりを地の色でふちどってから塗る（明るい所でも暗い所でも見える）
      const r = ORB_SIZE[v] * dpr;
      ctx.globalAlpha = o.alpha;
      ctx.fillStyle = rgbStr(colors.bg);
      ctx.beginPath();
      ctx.arc(x, y, r + 1.8 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = strength;
      ctx.fillStyle = rgbStr(color);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * いまの絵を、1枚の画像（円の正方形と、下の帯）にする（「残す」）。
   * 画面の上では、音名・まん中の音名・蓮は HTML の部品なので、ここで同じ位置に描き込む。
   * @param {object} o
   * @param {string} [o.note] まん中の音名（「ラ」）。なければ「観」
   * @param {string} [o.en] まん中の英語の音名（「A4」）
   * @param {string} [o.footer] 下の帯の右に書く1行（音名・高さ・日時など）
   * @param {boolean} [o.bloom] 蓮が開いているか
   * @param {{display:string, body:string, mono:string}} [o.fonts] 文字の書体（CSS の --font-display など）
   * @param {HTMLCanvasElement} [target] 描き込む板（動画で毎コマ描くときに使い回す）。なければ新しく作る
   * @returns {HTMLCanvasElement|null}
   */
  exportImage({ note = '', en = '', footer = '', bloom = false, fonts = {} } = {}, target = null) {
    const d = Math.round(this.size);
    if (!d || !this.w) return null;
    const { colors } = this;
    const display = fonts.display || 'serif';
    const body = fonts.body || 'sans-serif';
    const mono = fonts.mono || 'monospace';
    const pad = Math.round(d * 0.05);
    const band = Math.round(d * 0.14);
    const out = target || document.createElement('canvas');
    // 動画の板は、大きさが変わらないかぎり作り直さない（width を入れ直すと中身が消え、録画が乱れるため）
    if (out.width !== d + 2 * pad) out.width = d + 2 * pad;
    if (out.height !== d + 2 * pad + band) out.height = d + 2 * pad + band;
    const g = out.getContext('2d');
    g.fillStyle = rgbStr(colors.bg);
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(this.canvas, Math.round(this.cx - d / 2), Math.round(this.cy - d / 2), d, d, pad, pad, d, d);
    const ox = pad + d / 2;
    const oy = pad + d / 2;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 12の音名（12時がド。♯ の付く音は小さな点）
    Array.from({ length: 12 }, (_, k) => pcName(tuning.tonic + k)).forEach((name, k) => {
      const ang = -Math.PI / 2 + (k * Math.PI) / 6;
      const sharp = isAccidental(tuning.tonic + k);
      g.fillStyle = rgbStr(k === 0 ? colors.ink : colors.muted, sharp ? 0.7 : 1);
      g.font = `600 ${Math.round(d * (sharp ? 0.05 : 0.038))}px ${display}`;
      g.fillText(sharp ? '·' : name, ox + Math.cos(ang) * d * KOUHAI_GEOMETRY.rLabel, oy + Math.sin(ang) * d * KOUHAI_GEOMETRY.rLabel);
    });
    if (bloom) {
      // 蓮（画面の SVG と同じ形：直径を 100 とした座標）
      const petal = new Path2D('M0,-9 C10,-18 10,-33 0,-45 C-10,-33 -10,-18 0,-9Z');
      const unit = d / 100;
      for (const [offset, scale, color] of [[22.5, 1.04, colors.gold], [0, 0.8, colors.mark]]) {
        for (let i = 0; i < 8; i++) {
          g.save();
          g.translate(ox, oy);
          g.rotate(((offset + i * 45) * Math.PI) / 180);
          g.scale(unit * scale, unit * scale);
          g.fillStyle = rgbStr(color, 0.11);
          g.fill(petal);
          g.strokeStyle = rgbStr(color);
          g.lineWidth = 0.5 / scale;
          g.stroke(petal);
          g.restore();
        }
      }
      // 文字の下地（画面と同じく、地の色を少し透かした角丸の板）
      const bw = d * 0.34;
      const bh = d * 0.2;
      g.fillStyle = rgbStr(colors.bg, 0.84);
      g.beginPath();
      if (g.roundRect) g.roundRect(ox - bw / 2, oy - bh / 2, bw, bh, d * 0.015);
      else g.rect(ox - bw / 2, oy - bh / 2, bw, bh);
      g.fill();
      g.fillStyle = rgbStr(colors.ink);
      g.font = `800 ${Math.round(d * 0.066)}px ${display}`;
      spacedText(g, L('カノン', 'Canon'), ox, oy - d * 0.03, d * 0.014);
      g.fillStyle = rgbStr(colors.muted);
      g.font = `${Math.round(d * 0.036)}px ${body}`;
      g.fillText(L('響きは、巡る。', 'The sound comes around.'), ox, oy + d * 0.05);
    } else {
      // まん中（頭光）の音名
      // 高さがはっきりしないときは、まん中を空けておく
      g.fillStyle = rgbStr(colors.ink);
      g.font = `800 ${Math.round(d * 0.07)}px ${display}`;
      if (note) g.fillText(note, ox, en ? oy - d * 0.018 : oy);
      if (en) {
        g.fillStyle = rgbStr(colors.muted);
        g.font = `${Math.round(d * 0.034)}px ${mono}`;
        g.fillText(en, ox, oy + d * 0.04);
      }
    }
    // 下の帯：左に「光背」、右に1行
    const by = d + 2 * pad;
    g.fillStyle = rgbStr(colors.grid);
    g.fillRect(pad, by, d, Math.max(1, Math.round(d / 400)));
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = rgbStr(colors.ink);
    g.font = `800 ${Math.round(band * 0.36)}px ${display}`;
    const title = L('光背', 'Halo');
    g.fillText(title, pad, by + band / 2);
    const titleW = g.measureText(title).width;
    g.fillStyle = rgbStr(colors.muted);
    g.font = `${Math.round(band * 0.2)}px ${body}`;
    g.fillText(L('Halo', 'kōhai'), pad + titleW + band * 0.15, by + band / 2 + band * 0.04);
    // 右側：上に1行（音名など）、下にアプリの URL。SNS へファイルとして上げ直しても、見た人がたどり着けるように
    g.textAlign = 'right';
    g.font = `${Math.round(band * 0.22)}px ${body}`;
    if (footer) g.fillText(footer, pad + d, by + band * 0.34);
    g.font = `${Math.round(band * 0.19)}px ${mono}`;
    g.fillText(APP_URL_LABEL, pad + d, by + band * (footer ? 0.7 : 0.5));
    return out;
  }
}
