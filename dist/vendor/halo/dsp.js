/**
 * dsp.js — 音を「数字」にするための道具箱
 *
 * DSP は Digital Signal Processing（デジタル・シグナル・プロセッシング）の略で、
 * 「デジタルの信号（ここでは音）を計算で処理すること」という意味です。
 *
 * ここにある関数は、すべて「数字の並びを受け取って、結果を返すだけ」の純粋な関数です。
 * 画面にもマイクにも触らないので、ブラウザでも Node.js でも同じように動き、テストもできます。
 *
 * 用語メモ
 *  - サンプル（sample）: 音を1秒間に何万回も測った「1回分の測定値」。-1〜+1 の数。
 *  - サンプリング周波数（sample rate）: 1秒あたりの測定回数。スマホは 48000 回が多い。
 *  - dBFS: デジタルの最大値（Full Scale）を基準にした大きさ。0 が上限で、小さい音ほどマイナス。
 */

/** 値を [lo, hi] の範囲に収める */
export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// ---------------------------------------------------------------------------
// 大きさ（振幅・デシベル）
// ---------------------------------------------------------------------------

/**
 * RMS（Root Mean Square：二乗平均の平方根）。
 * 「波の上下を全部プラスにして平均した、ならした大きさ」。音のエネルギーに対応する。
 */
export function rms(x, start = 0, end = x.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  const n = end - start;
  return n > 0 ? Math.sqrt(s / n) : 0;
}

/** いちばん大きく振れた量（絶対値の最大） */
export function peakAbs(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

/** これより小さい dB は「無音」として扱う（log10(0) = -∞ を避けるため） */
export const DB_FLOOR = -160;

/** 振幅の比 → dB。dB = 20 × log10(振幅 / 基準)。振幅が2倍で約 +6 dB。 */
export function ampToDb(amp, ref = 1) {
  if (!(amp > 0)) return DB_FLOOR;
  return Math.max(DB_FLOOR, 20 * Math.log10(amp / ref));
}

/** dB → 振幅の比 */
export function dbToAmp(db) {
  return Math.pow(10, db / 20);
}

/** エネルギー（パワー）の比 → dB。dB = 10 × log10(パワー)。エネルギーが2倍で約 +3 dB。 */
export function powerToDb(power) {
  if (!(power > 0)) return DB_FLOOR;
  return Math.max(DB_FLOOR, 10 * Math.log10(power));
}

// ---------------------------------------------------------------------------
// FFT（高速フーリエ変換）：音を「どの高さの成分が、どれだけ」に分ける
// ---------------------------------------------------------------------------

const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

/** n が 2 のべき乗（2, 4, 8, …, 4096 …）かどうか */
export function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * FFT 本体（その場で書き換える）。re が実部、im が虚部。長さは 2 のべき乗。
 * 考え方：長い計算を「半分の長さの計算2つ」に分ける、をくり返して速くする（分割統治）。
 */
export function fft(re, im) {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error('FFT の長さは 2 のべき乗で、re と im は同じ長さにしてください');
  // 1) ビット反転の並べ替え（あとで隣どうしを組み合わせやすい順番にする）
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // 2) バタフライ演算（2つずつ組み合わせて、足した結果と引いた結果を作る）
  const { cos, sin } = twiddles(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const br = re[b] * wr - im[b] * wi;
        const bi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - br; im[b] = im[a] - bi;
        re[a] += br; im[a] += bi;
      }
    }
  }
}

const windowCache = new Map();
/**
 * 窓関数（window function）：切り取った音の両端をなめらかに 0 へ近づける「フェード」。
 * 端がブツッと切れていると、ありもしない成分が出てしまう（漏れ）。それを減らすため。
 */
export function makeWindow(n, type = 'hann') {
  const key = type + n;
  let w = windowCache.get(key);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = (2 * Math.PI * i) / n;
      w[i] = type === 'blackman' ? 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x) : 0.5 - 0.5 * Math.cos(x);
    }
    windowCache.set(key, w);
  }
  return w;
}

/** x の末尾 n サンプル（いちばん新しい部分）を取り出す位置 */
function tailOffset(x, n) {
  return Math.max(0, x.length - n);
}

/**
 * パワースペクトル：周波数ごとの「エネルギーの取り分」。
 * 返す配列の合計が、元の音の平均二乗（RMS の二乗）にほぼ一致するように調整してある（パーセバルの定理）。
 * out[k] は周波数 k × (sampleRate / n) [Hz] の成分。
 */
export function powerSpectrum(x, n = largestPow2(x.length)) {
  const w = makeWindow(n, 'hann');
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const off = tailOffset(x, n);
  let wPow = 0;
  for (let i = 0; i < n; i++) {
    re[i] = (x[off + i] || 0) * w[i];
    wPow += w[i] * w[i];
  }
  fft(re, im);
  const half = n >> 1;
  const out = new Float64Array(half + 1);
  const norm = 1 / (n * wPow); // = 1 / (n² × 窓の平均パワー)
  for (let k = 0; k <= half; k++) {
    const p = (re[k] * re[k] + im[k] * im[k]) * norm;
    out[k] = k === 0 || k === half ? p : 2 * p;
  }
  return out;
}

/**
 * ブラウザの AnalyserNode と同じやり方の振幅スペクトル [dB]。
 * （Blackman 窓 → FFT → 長さで割る → 20 log10）。画面の色の濃さをそろえるために使う。
 */
export function analyserLikeDb(x, n = largestPow2(x.length), out = new Float32Array(n >> 1)) {
  const w = makeWindow(n, 'blackman');
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const off = tailOffset(x, n);
  for (let i = 0; i < n; i++) re[i] = (x[off + i] || 0) * w[i];
  fft(re, im);
  for (let k = 0; k < out.length; k++) {
    const mag = Math.hypot(re[k], im[k]) / n;
    out[k] = mag > 0 ? 20 * Math.log10(mag) : DB_FLOOR;
  }
  return out;
}

/** n 以下で最大の 2 のべき乗 */
export function largestPow2(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

// ---------------------------------------------------------------------------
// 人の耳に合わせた重み付け（A特性）
// ---------------------------------------------------------------------------

/**
 * A特性（A-weighting）[dB]：人の耳の「聞こえやすさ」を表す補正。
 * 人の耳は 1〜4 kHz あたりがいちばん敏感で、低い音（100 Hz で約 -19 dB）や
 * とても高い音には鈍い。騒音計の dB(A) はこの補正をかけた値。IEC 61672 の式。
 */
export function aWeightingDb(f) {
  if (!(f > 0)) return DB_FLOOR;
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

const aTableCache = new Map();
/** パワースペクトルの各ビンにかける A特性の「パワーの倍率」表 */
export function aWeightTable(n, sampleRate) {
  const key = n + ':' + sampleRate;
  let t = aTableCache.get(key);
  if (!t) {
    const half = n >> 1;
    t = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      const db = aWeightingDb((k * sampleRate) / n);
      t[k] = db <= DB_FLOOR ? 0 : Math.pow(10, db / 10);
    }
    aTableCache.set(key, t);
  }
  return t;
}

/** パワースペクトルに重みをかけて合計し、dB にする */
export function weightedLevelDb(power, weights) {
  let s = 0;
  for (let k = 0; k < power.length; k++) s += power[k] * (weights ? weights[k] : 1);
  return powerToDb(s);
}

// ---------------------------------------------------------------------------
// 音の「性格」を表す特徴量
// ---------------------------------------------------------------------------

/** 指定した周波数帯 [lo, hi) のエネルギーの合計 */
export function bandEnergy(power, binHz, lo, hi) {
  const k0 = Math.max(0, Math.ceil(lo / binHz));
  const k1 = Math.min(power.length - 1, Math.floor((hi - 1e-9) / binHz));
  let s = 0;
  for (let k = k0; k <= k1; k++) s += power[k];
  return s;
}

/**
 * スペクトル重心（spectral centroid）：エネルギーの「重心」がどの高さにあるか [Hz]。
 * 高いほど「明るい・シャリシャリした」音、低いほど「こもった・ゴーッとした」音。
 */
export function spectralCentroid(power, binHz, lo = 20, hi = Infinity) {
  let num = 0;
  let den = 0;
  const k0 = Math.max(1, Math.ceil(lo / binHz));
  const k1 = Math.min(power.length - 1, Math.floor(hi / binHz));
  for (let k = k0; k <= k1; k++) {
    num += k * binHz * power[k];
    den += power[k];
  }
  return den > 0 ? num / den : 0;
}

/**
 * スペクトル平坦度（spectral flatness）：0〜1。
 * 「幾何平均 ÷ 算術平均」。全部の高さに均等にエネルギーがある雑音ほど大きく（1回の測定では約 0.56）、
 * 特定の高さだけに線のように集まる澄んだ音ほど 0 に近い。
 */
export function spectralFlatness(power, k0, k1) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  const eps = 1e-20;
  for (let k = Math.max(1, k0); k <= Math.min(power.length - 1, k1); k++) {
    logSum += Math.log(power[k] + eps);
    sum += power[k] + eps;
    n++;
  }
  if (!n || sum <= n * eps * 1.0001) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

/** 平坦度を測る帯域の区切り（オクターブごと） [Hz] */
export const FLATNESS_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];

/**
 * 帯域ごとの平坦度を、エネルギーの多い帯域を重く見て平均したもの。
 * 全体で測ると「低い音が多い雑音」も傾きのせいで澄んだ音に見えてしまうので、帯域を区切って測る。
 */
export function bandFlatness(power, binHz, edges = FLATNESS_BANDS) {
  let wSum = 0;
  let fSum = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const k0 = Math.ceil(edges[i] / binHz);
    const k1 = Math.floor(edges[i + 1] / binHz);
    if (k1 - k0 < 3 || k1 >= power.length) continue;
    let e = 0;
    for (let k = k0; k <= k1; k++) e += power[k];
    if (e <= 0) continue;
    fSum += spectralFlatness(power, k0, k1) * e;
    wSum += e;
  }
  return wSum > 0 ? fSum / wSum : 0;
}

/** いちばん強い成分の周波数 [Hz]（隣のビンとの放物線補間で、ビンの間も推定） */
export function peakFrequency(power, binHz, lo = 20, hi = Infinity) {
  const k0 = Math.max(1, Math.ceil(lo / binHz));
  const k1 = Math.min(power.length - 2, Math.floor(hi / binHz));
  let best = -1;
  let bestP = 0;
  for (let k = k0; k <= k1; k++) {
    if (power[k] > bestP) {
      bestP = power[k];
      best = k;
    }
  }
  if (best < 1) return 0;
  const a = Math.log(power[best - 1] + 1e-30);
  const b = Math.log(power[best] + 1e-30);
  const c = Math.log(power[best + 1] + 1e-30);
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return (best + clamp(shift, -0.5, 0.5)) * binHz;
}

/**
 * スペクトルの「山（ピーク）」を探す。大きい順に最大 maxPeaks 個。
 * 山の高さが、いちばん高い山から rangeDb 以内のものだけを数える。
 */
export function spectralPeaks(power, binHz, { lo = 50, hi = 5000, rangeDb = 35, maxPeaks = 12, guard = 3 } = {}) {
  const k0 = Math.max(guard, Math.ceil(lo / binHz));
  const k1 = Math.min(power.length - 1 - guard, Math.floor(hi / binHz));
  let maxP = 0;
  for (let k = k0; k <= k1; k++) if (power[k] > maxP) maxP = power[k];
  if (maxP <= 0) return [];
  const floor = maxP * Math.pow(10, -rangeDb / 10);
  const peaks = [];
  for (let k = k0; k <= k1; k++) {
    const p = power[k];
    if (p < floor) continue;
    let isMax = true;
    for (let j = 1; j <= guard && isMax; j++) if (power[k - j] > p || power[k + j] >= p) isMax = false;
    if (!isMax) continue;
    // 放物線補間で、ビンとビンの間の本当の山の位置を推定する
    const a = Math.log(power[k - 1] + 1e-30);
    const b = Math.log(p + 1e-30);
    const c = Math.log(power[k + 1] + 1e-30);
    const den = a - 2 * b + c;
    const shift = den !== 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
    peaks.push({ k, hz: (k + shift) * binHz, p });
  }
  peaks.sort((a, b) => b.p - a.p);
  return peaks.slice(0, maxPeaks);
}

/**
 * 倍音のそろい具合（harmonicity）：0〜1。
 * スペクトルの山のうち、基本の高さ f0 の整数倍（2倍、3倍…）の位置にある山の割合。
 * 雑音でも偶然そろう分があるので、その分を差し引いて 0〜1 に直す。
 * 声や弦・管楽器は整数倍にきれいに並ぶ（1 に近い）。鐘・鈴（整数倍でない）や雑音は 0 に近い。
 *
 * 手順：①ゆるい基準（±4%）で倍音らしい山を集め、それらにいちばん合う f0 を計算し直す（最小二乗法）。
 *       ②その f0 で、きびしい基準（±1.5% ≒ ±26 セント）で数え直す。
 */
export function harmonicity(power, binHz, f0, { tol = 0.015, maxHz = 5000 } = {}) {
  if (!(f0 > 0)) return 0;
  const peaks = spectralPeaks(power, binHz, { lo: Math.max(50, 0.75 * f0), hi: maxHz });
  if (peaks.length < 2) return 0;
  // ① f0 を山の位置に合わせて計算し直す： f0' = Σ(h·f) / Σ(h²)
  let num = 0;
  let den = 0;
  for (const pk of peaks) {
    const h = Math.max(1, Math.round(pk.hz / f0));
    if (Math.abs(pk.hz - h * f0) <= 0.04 * h * f0) {
      num += h * pk.hz;
      den += h * h;
    }
  }
  const fr = den > 0 ? num / den : f0;
  // ② きびしい基準で数える
  let onHarmonic = 0;
  let chance = 0;
  for (const pk of peaks) {
    const h = Math.max(1, Math.round(pk.hz / fr));
    const win = Math.max(tol * h * fr, 0.35 * binHz);
    if (Math.abs(pk.hz - h * fr) <= win) onHarmonic++;
    chance += Math.min(1, (2 * win) / fr); // でたらめな山が、たまたま窓に入る確率
  }
  chance = Math.min(0.9, chance / peaks.length);
  return clamp((onHarmonic / peaks.length - chance) / (1 - chance), 0, 1);
}

/** 波形が 0 をまたいだ回数の割合（0〜1）。シャー音のような高い雑音ほど多い。 */
export function zeroCrossingRate(x) {
  let c = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] >= 0) !== (x[i] >= 0)) c++;
  return x.length > 1 ? c / (x.length - 1) : 0;
}

// ---------------------------------------------------------------------------
// 音の高さ（ピッチ）の検出：YIN 法
// ---------------------------------------------------------------------------

/**
 * YIN 法（de Cheveigné & Kawahara, 2002）で基本周波数を推定する。
 *
 * たとえ話：同じ模様がくり返す布を、少しずつずらして重ねていく。
 *   模様がぴったり重なる「ずらし幅」が、くり返しの長さ（周期 T）。周波数 f = 1 / T。
 *
 * 返り値 { freq, clarity }
 *   freq    … 推定した高さ [Hz]（はっきりしなければ 0）
 *   clarity … 周期性（0〜1）。1 に近いほど「高さがはっきりした音」。
 */
export function yinPitch(x, sampleRate, { fMin = 60, fMax = 2000, threshold = 0.2, minRms = 1e-6 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / fMax));
  const tauMax = Math.min(Math.ceil(sampleRate / fMin), Math.floor(x.length / 2));
  const W = x.length - tauMax; // 重ねて比べる長さ
  if (tauMax <= tauMin + 2 || W < 32) return { freq: 0, clarity: 0 };
  if (rms(x) < minRms) return { freq: 0, clarity: 0 }; // ほぼ無音（-120 dB 未満）なら測らない

  // 1) 差の関数 d(τ)：τ だけずらして重ねたときの「ずれ具合」
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[j] - x[j + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // 2) 累積平均で割って正規化 d'(τ)：音の大小に左右されない「ずれ具合」にする
  const dn = new Float64Array(tauMax + 1);
  dn[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    dn[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // 3) しきい値より小さくなる最初の谷を探す（いちばん短い周期を選ぶとオクターブの間違いが減る）
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dn[tau] < threshold) {
      while (tau + 1 <= tauMax && dn[tau + 1] < dn[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    // 見つからなければ、いちばん深い谷（ただし周期性は低い）
    let best = tauMin;
    for (let tau = tauMin + 1; tau <= tauMax; tau++) if (dn[tau] < dn[best]) best = tau;
    tauEst = best;
  }
  // 4) 放物線で谷の底をなめらかに推定（サンプルの間の値も求める）
  let tau = tauEst;
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = dn[tauEst - 1];
    const s1 = dn[tauEst];
    const s2 = dn[tauEst + 1];
    const den = 2 * (s0 + s2 - 2 * s1);
    if (den > 0) tau = tauEst + clamp((s0 - s2) / den, -1, 1);
  }
  const clarity = clamp(1 - dn[tauEst], 0, 1);
  const freq = sampleRate / tau;
  if (!(freq >= fMin * 0.95 && freq <= fMax * 1.05)) return { freq: 0, clarity: 0 };
  return { freq, clarity };
}

// ---------------------------------------------------------------------------
// 音階（ドレミ）
// ---------------------------------------------------------------------------

export const NOTE_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const NOTE_JA = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];

/** 周波数 → MIDI 番号（ラ A4 = 440 Hz が 69、半音ごとに 1 ずつ） */
export function freqToMidi(f, a4 = 440) {
  return 69 + 12 * Math.log2(f / a4);
}

/** MIDI 番号 → 周波数。f = 440 × 2^((n − 69) / 12) */
export function midiToFreq(m, a4 = 440) {
  return a4 * Math.pow(2, (m - 69) / 12);
}

/**
 * 周波数から音名を求める。
 * セント（cent）は半音を 100 に分けた単位。±50 セントの範囲で一番近い音に丸める。
 */
export function noteInfo(freq, a4 = 440) {
  if (!(freq > 0)) return null;
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return {
    midi,
    cents: Math.round((exact - midi) * 100),
    pitchClass: pc,
    octave,
    en: NOTE_EN[pc] + octave,
    ja: NOTE_JA[pc],
    target: midiToFreq(midi, a4),
  };
}

// ---------------------------------------------------------------------------
// そのほかの物理の公式
// ---------------------------------------------------------------------------
