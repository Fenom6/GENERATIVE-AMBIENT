/** 音の選択だけを担当。時刻と種が同じなら、同じ判断を再現できる。 */
export const WORLDS = Object.freeze({
  pentatonic: {
    name: '日本・五音', naming: 'ja', quarter: false,
    notes: [0, 2, 4, 7, 9], chords: [[4, 7], [2, 7], [4, 9], [7, 9]],
    description: 'ド・レ・ミ・ソ・ラ。余白のある、明るい五音。',
  },
  india: {
    name: 'インド風・五音', naming: 'sargam', quarter: false,
    notes: [0, 2, 4, 7, 9], chords: [[7, 9], [2, 7], [4, 7], [2, 9]],
    description: 'Sa・Re・Ga・Pa・Dha。ブーパーリーの五音を参考にした試作。',
  },
  arab: {
    name: 'アラブ風・四分音', naming: 'en', quarter: true,
    notes: [0, 2, 3.5, 5, 7, 9, 10.5], chords: [[3.5, 7], [5, 7], [7, 10.5], [2, 7]],
    description: '半音の間にも音を置く、ラストを参考にした24等分近似。',
  },
});

export const DEFAULTS = Object.freeze({
  world: 'pentatonic', tuning: 'just', tonic: 0, a4: 440,
  density: 0.65, trail: 2, volume: 0.18, minutes: 15,
  layers: Object.freeze({ drone: true, harmony: true, sparkle: true }),
});

const clamp = (value, low, high, fallback) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;

export function settings(input = {}) {
  return {
    world: Object.hasOwn(WORLDS, input.world) ? input.world : DEFAULTS.world,
    tuning: input.tuning === 'equal' ? 'equal' : 'just',
    tonic: Math.round(clamp(input.tonic, 0, 11, DEFAULTS.tonic)),
    a4: clamp(input.a4, 415, 466, DEFAULTS.a4),
    density: clamp(input.density, 0.2, 1, DEFAULTS.density),
    trail: clamp(input.trail, 1.2, 3, DEFAULTS.trail),
    volume: clamp(input.volume, 0, 0.5, DEFAULTS.volume),
    minutes: [0, 5, 15, 30, 60].includes(Number(input.minutes)) ? Number(input.minutes) : DEFAULTS.minutes,
    layers: Object.fromEntries(Object.keys(DEFAULTS.layers).map((key) => [key,
      typeof input.layers?.[key] === 'boolean' ? input.layers[key] : true])),
  };
}

export function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiHz = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const hzMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

const RATIOS = new Map([[0, 1], [2, 9 / 8], [4, 5 / 4], [5, 4 / 3], [7, 3 / 2], [9, 5 / 3]]);
export function intervalRatio(interval, tuning = 'just') {
  const octaves = Math.floor(interval / 12);
  const pitch = ((interval % 12) + 12) % 12;
  // 四分音には12音用の純正比を押し付けず、選択した四分音の位置を保つ。
  return 2 ** octaves * (tuning === 'just' && RATIOS.has(pitch) ? RATIOS.get(pitch) : 2 ** (pitch / 12));
}

export function fitFrequency(hz, lowMidi, highMidi, a4 = 440) {
  const low = midiHz(lowMidi, a4), high = midiHz(highMidi, a4);
  if (!(hz > 0) || !Number.isFinite(hz)) throw new RangeError('Invalid frequency');
  while (hz < low - 1e-7) hz *= 2;
  while (hz > high + 1e-7) hz /= 2;
  return hz;
}

// マルコフ連鎖：いまの和音ごとに、次の和音を選ぶ重みが異なる。
const TRANSITIONS = [[1, 4, 2, 1], [3, 1, 4, 2], [4, 2, 1, 3], [3, 4, 2, 1]];
function weighted(weights, random) {
  let choice = random() * weights.reduce((sum, value) => sum + value, 0);
  return Math.max(0, weights.findIndex((value) => (choice -= value) < 0));
}

export class AmbientPlanner {
  constructor(config = {}, seed = 'halo', start = 0) {
    this.config = settings(config);
    this.seed = String(seed);
    this.random = seededRandom(seed);
    this.rootOffset = 0;
    this.chord = 0;
    this.serial = 0;
    this.next = { root: start + this.range(120, 240), drone: start, harmony: start + 0.6, sparkle: start + 2 };
  }

  range(min, max) { return min + this.random() * (max - min); }

  rootHz() {
    const { tonic, tuning, a4 } = this.config;
    return fitFrequency(midiHz(36 + tonic, a4) * intervalRatio(this.rootOffset, tuning), 36, 48, a4);
  }

  event(layer, hz, at, duration, interval = 0, source = '音階') {
    return { id: ++this.serial, layer, hz, midi: hzMidi(hz), at, duration,
      rootHz: this.rootHz(), rootOffset: this.rootOffset, interval, source };
  }

  /** 過去の取りこぼしを一気に鳴らさない。次回は常に現在時刻から予約する。 */
  advance(now) {
    if (!Number.isFinite(now)) throw new RangeError('Invalid clock');
    const result = [], config = this.config, world = WORLDS[config.world];
    if (now >= this.next.root) {
      this.rootOffset = [0, 7, 5][weighted(this.rootOffset === 0 ? [1, 3, 2] : [5, 1, 1], this.random)];
      this.next.root = now + this.range(120, 240);
      this.next.drone = now;
      this.next.harmony = now + 0.8;
    }
    const root = this.rootHz();
    if (now >= this.next.drone) {
      const breath = this.range(12, 20);
      this.next.drone = now + breath;
      if (config.layers.drone) result.push(this.event('drone', root, now, breath + 2));
    }
    if (now >= this.next.harmony) {
      const gap = this.range(4, 8);
      this.next.harmony = now + gap;
      this.chord = weighted(TRANSITIONS[this.chord], this.random);
      const intervals = world.chords[this.chord];
      const count = this.random() < config.density ? 2 : 1;
      if (config.layers.harmony) for (const interval of intervals.slice(0, count)) {
        const hz = fitFrequency(root * 2 * intervalRatio(interval, config.tuning), 48, 72, config.a4);
        result.push(this.event('harmony', hz, now, gap + 3, interval));
      }
    }
    if (now >= this.next.sparkle) {
      this.next.sparkle = now + this.range(2, 6);
      if (config.layers.sparkle && this.random() < config.density) {
        const harmonic = config.world !== 'arab' && config.tuning === 'just' && this.random() < 0.4;
        const interval = world.notes[Math.floor(this.random() * world.notes.length)];
        const multiple = [8, 10, 12, 16, 18, 20, 24][Math.floor(this.random() * 7)];
        const hz = fitFrequency(root * (harmonic ? multiple : 8 * intervalRatio(interval, config.tuning)), 72, 96, config.a4);
        result.push(this.event('sparkle', hz, now, this.range(3, 5), interval, harmonic ? '自然倍音' : '音階'));
      }
    }
    return result;
  }
}
