import { midiToTurn, spiralPoint, syncSpiral } from '../vendor/halo/kouhai.js';
import { TimedKouhaiView } from './timed-kouhai.js';
import { buildLut } from '../vendor/halo/colormap.js';
import { setTuning, pcName, isAccidental, describe } from '../vendor/halo/tuning.js';
import { WORLDS, rootFrequency, hzMidi, intervalRatio, fitFrequency } from './music.js';

const COLORS = { drone: '#d9c998', harmony: '#b5cfba', sparkle: '#b2b4ce' };

export class HaloView {
  constructor(spectrum, geometry, labels) {
    this.canvas = spectrum;
    this.overlay = geometry;
    this.labels = labels;
    this.view = new TimedKouhaiView(spectrum);
    this.context = geometry.getContext('2d');
    this.view.setPalette(buildLut(['#14221a', '#536545', '#9eaf7b', '#d5c98f', '#f2e8c0']), {
      bg: '#090f0d', grid: '#233329', ink: '#eeeadd', muted: '#61765f', mark: '#b5cfba', gold: '#d9c998',
    });
    this.view.setVoiceColors(Object.values(COLORS));
    this.silence = new Float32Array(8192).fill(-100);
    this.events = [];
    this.mode = 'idle';
    this.trail = 2;
    this.resize();
  }

  configure(config, sampleRate = 48000) {
    const world = WORLDS[config.world];
    this.layers = config.layers;
    const root = rootFrequency(config);
    this.preview = [
      { id: -1, layer: 'drone', midi: hzMidi(root), at: 0, duration: 100 },
      ...world.chords[0].map((interval, i) => ({ id: -2 - i, layer: 'harmony',
        midi: hzMidi(fitFrequency(root * 2 * intervalRatio(interval, config.tuning), 48, 72, config.a4)), at: 0, duration: 100 })),
      { id: -4, layer: 'sparkle', midi: hzMidi(fitFrequency(root * 8, 72, 96, config.a4)), at: 0, duration: 100 },
    ];
    setTuning({ a4: config.a4, tonic: config.tonic, naming: world.naming, quarter: world.quarter });
    syncSpiral();
    this.view.configure({ sampleRate, fftSize: 16384, minDb: -100, maxDb: -20 });
    this.trail = config.trail;
    this.view.setTrailSeconds(config.trail);
    this.labels.replaceChildren();
    for (let index = 0; index < 12; index++) {
      const label = document.createElement('span'), pc = (config.tonic + index) % 12;
      label.className = `dial-label${isAccidental(pc) ? ' accidental' : ''}${index === 0 ? ' tonic' : ''}`;
      label.textContent = pcName(pc);
      const angle = index * Math.PI / 6 - Math.PI / 2;
      label.style.left = `${50 + Math.cos(angle) * 46.5}%`;
      label.style.top = `${50 + Math.sin(angle) * 46.5}%`;
      this.labels.append(label);
    }
    this.view.paintBase();
    this.view.clear();
  }

  resize() {
    this.view.resize();
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
  }

  reset(mode = 'stopped') { this.events = []; this.mode = mode; this.view.clear(); }
  add(events) { this.events.push(...events); this.events = this.events.slice(-48); }

  point(midi) {
    const p = spiralPoint(Math.max(0, Math.min(7, midiToTurn(midi))), this.view.size);
    return { x: this.view.cx + p.x, y: this.view.cy + p.y };
  }

  frame(audio, elapsed, dt, running) {
    if (!this.view.w) return;
    this.view.setTrailSeconds(this.trail);
    this.view.setTime(elapsed);
    const data = running && audio ? audio.spectrumData() : { slow: this.silence, fast: null };
    const active = this.events.filter((event) => elapsed <= event.at + event.duration);
    const notes = ['drone', 'harmony', 'sparkle'].map((layer) => active.findLast((event) => event.layer === layer)?.midi ?? null);
    this.view.draw(data.slow, running ? notes : [], { dt: Math.min(dt, 60), fast: data.fast, still: !running });
    const ctx = this.context, dpr = this.view.dpr;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const preview = this.mode === 'idle';
    let events = this.events.filter((event) => elapsed <= event.at + event.duration + this.trail);
    this.events = events;
    if (preview) events = (this.preview || []).filter((event) => this.layers[event.layer]);
    const opacity = (event) => {
      if (preview) return 0.38;
      const age = Math.max(0, elapsed - event.at), tail = Math.max(0, age - event.duration);
      const attack = event.layer === 'sparkle' ? 0.08 : 2;
      return Math.min(1, age / attack) * Math.exp(-tail * 3 / this.trail)
        * (event.layer === 'drone' ? 0.65 + 0.35 * Math.sin(Math.PI * age / event.duration) : 1);
    };
    const root = events.findLast((event) => event.layer === 'drone');
    const harmony = events.filter((event) => event.layer === 'harmony');
    if (root && harmony.length) {
      const latest = harmony.at(-1).at, chord = harmony.filter((event) => event.at === latest);
      const points = [root, ...chord].map((event) => this.point(event.midi));
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      if (points.length > 2) ctx.closePath();
      ctx.strokeStyle = '#b5cfba'; ctx.globalAlpha = opacity(chord[0]) * 0.34;
      ctx.lineWidth = dpr * 0.8; ctx.stroke();
      if (points.length > 2) { ctx.globalAlpha *= 0.055; ctx.fillStyle = '#c9c79a'; ctx.fill(); }
    }
    for (const event of events) {
      const p = this.point(event.midi), alpha = opacity(event), color = COLORS[event.layer];
      const dx = p.x - this.view.cx, dy = p.y - this.view.cy, angle = Math.atan2(dy, dx);
      const inner = this.view.size * 0.106;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = alpha * (preview ? 0.7 : 0.45);
      ctx.lineWidth = dpr * (event.layer === 'drone' ? 2 : 0.8);
      ctx.beginPath();
      ctx.moveTo(this.view.cx + Math.cos(angle) * inner, this.view.cy + Math.sin(angle) * inner);
      ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color; ctx.shadowBlur = (preview ? 7 : 14) * dpr;
      ctx.beginPath(); ctx.arc(p.x, p.y, dpr * (event.layer === 'drone' ? 3 : 2), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (event.layer === 'sparkle' && !preview) {
        const age = Math.max(0, elapsed - event.at);
        ctx.globalAlpha = alpha * Math.max(0, 1 - age / 4) * 0.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, dpr * (4 + age * 11), 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  noteText(hz) {
    const note = describe(hz);
    return note ? `${note.name}${note.octave}` : '—';
  }
}
