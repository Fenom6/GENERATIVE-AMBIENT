import { settings } from './music.js';

export const MAX_VOICES = 16;
export const WATCHDOG_SECONDS = 1.4;
const PEAKS = { drone: 0.28, harmony: 0.12, sparkle: 0.1 };

/** Web Audio：端末内で波を作る。外部の音源や通信には依存しない。 */
export class AmbientAudio {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.Context = Context;
    this.context = null;
    this.voices = new Map();
    this.closed = false;
    this.muted = false;
    this.volume = 0.18;
  }

  async open(config = {}) {
    if (!this.Context) throw new Error('このブラウザーは音声生成に対応していません');
    this.closed = false;
    this.context = new this.Context({ latencyHint: 'playback' });
    const context = this.context;
    this.mix = context.createGain();
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 6500;
    this.filter.Q.value = 0.4;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 16;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.4;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 16384;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -20;
    this.analyser.smoothingTimeConstant = 0.78;
    this.fastAnalyser = context.createAnalyser();
    this.fastAnalyser.fftSize = 4096;
    this.fastAnalyser.minDecibels = -100;
    this.fastAnalyser.maxDecibels = -20;
    this.volumeNode = context.createGain();
    this.watchdog = context.createGain();
    this.watchdog.gain.value = 0;
    this.output = context.createAnalyser();
    this.output.fftSize = 2048;
    this.samples = new Float32Array(this.output.fftSize);
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.fastSpectrum = new Float32Array(this.fastAnalyser.frequencyBinCount);
    this.mix.connect(this.filter).connect(this.compressor).connect(this.analyser)
      .connect(this.fastAnalyser).connect(this.volumeNode).connect(this.watchdog)
      .connect(this.output).connect(context.destination);

    // 短い残響。録音・ダウンロード・外部サンプルは使わない。
    const convolver = context.createConvolver();
    const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 2.6), context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3 * 0.28;
    }
    convolver.buffer = impulse;
    this.wet = context.createGain();
    this.wet.gain.value = 0.24;
    this.mix.connect(convolver).connect(this.wet).connect(this.filter);
    this.setVolume(settings(config).volume);
    await context.resume();
    if (this.closed || context !== this.context) return false;
    if (context.state !== 'running') throw new Error('音声を開始できませんでした。もう一度開始してください');
    return true;
  }

  keepAlive() {
    if (this.closed || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime, gain = this.watchdog.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(1, now);
    gain.setValueAtTime(1, now + 0.8);
    gain.linearRampToValueAtTime(0, now + WATCHDOG_SECONDS);
  }

  setVolume(value) {
    this.volume = settings({ volume: value }).volume;
    if (this.volumeNode && !this.closed) {
      const now = this.context.currentTime;
      this.volumeNode.gain.cancelScheduledValues(now);
      this.volumeNode.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.06);
    }
  }

  setMuted(muted) { this.muted = Boolean(muted); this.setVolume(this.volume); }

  play(event) {
    const context = this.context;
    if (this.closed || !context || context.state !== 'running') return false;
    if (this.voices.size >= MAX_VOICES) throw new Error('同時発音数の上限');
    if (!Object.hasOwn(PEAKS, event.layer) || !Number.isFinite(event.hz) || event.hz < 60 || event.hz > 4400
      || !Number.isFinite(event.duration) || event.duration < 0.1 || event.duration > 23) throw new RangeError('音の指定が範囲外です');
    const now = context.currentTime;
    const oscillator = context.createOscillator(), envelope = context.createGain(), pan = context.createStereoPanner();
    oscillator.frequency.value = event.hz;
    if (event.layer === 'sparkle') oscillator.type = 'sine';
    else {
      const partials = event.layer === 'drone' ? [0, 1, 0.2, 0.08] : [0, 1, 0.16, 0.05, 0.025];
      oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials)));
    }
    pan.pan.value = event.layer === 'drone' ? 0 : Math.sin(event.id * 2.4) * 0.55;
    const duration = event.duration, attack = event.layer === 'sparkle' ? 0.025 : Math.min(3.5, duration * 0.25);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(PEAKS[event.layer], now + attack);
    if (event.layer === 'drone') envelope.gain.linearRampToValueAtTime(PEAKS.drone * 0.65, now + duration * 0.65);
    else if (event.layer === 'harmony') envelope.gain.setValueAtTime(PEAKS.harmony * 0.85, now + duration * 0.55);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    envelope.gain.setValueAtTime(0, now + duration + 0.04);
    oscillator.connect(envelope).connect(pan).connect(this.mix);
    const entry = { ...event, start: now, end: now + duration, oscillator, envelope, pan };
    this.voices.set(event.id, entry);
    oscillator.onended = () => {
      oscillator.disconnect(); envelope.disconnect(); pan.disconnect();
      this.voices.delete(event.id);
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.06);
    return true;
  }

  silenceLayer(layer) {
    if (!this.context || this.closed) return;
    for (const entry of this.voices.values()) if (entry.layer === layer) {
      entry.envelope.gain.cancelScheduledValues(this.context.currentTime);
      entry.envelope.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      try { entry.oscillator.stop(this.context.currentTime + 0.4); } catch { /* 既に終了した音 */ }
    }
  }

  observe() {
    if (!this.context || this.closed) return { state: 'closed', peak: 0, voices: 0 };
    this.output.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const value of this.samples) {
      if (!Number.isFinite(value)) return { state: 'invalid', peak: NaN, voices: this.voices.size };
      peak = Math.max(peak, Math.abs(value));
    }
    return { state: this.context.state, peak, voices: this.voices.size };
  }

  spectrumData() {
    this.analyser.getFloatFrequencyData(this.spectrum);
    this.fastAnalyser.getFloatFrequencyData(this.fastSpectrum);
    return { slow: this.spectrum, fast: this.fastSpectrum };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    // 出口を先に閉じる。予定されている音・残響も通さない。
    this.watchdog?.gain.cancelScheduledValues(now);
    this.watchdog?.gain.setValueAtTime(0, now);
    this.volumeNode?.gain.cancelScheduledValues(now);
    this.volumeNode?.gain.setValueAtTime(0, now);
    for (const entry of this.voices.values()) {
      try { entry.oscillator.stop(now); } catch { /* 終了済み */ }
      entry.oscillator.disconnect(); entry.envelope.disconnect(); entry.pan.disconnect();
    }
    this.voices.clear();
    this.mix?.disconnect();
    this.output?.disconnect();
    if (context.state !== 'closed') await context.close();
  }
}
