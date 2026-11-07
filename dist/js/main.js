import { DEFAULTS, WORLDS, AmbientPlanner, settings } from './music.js';
import { AmbientAudio } from './audio.js';
import { SessionGate } from './session.js';
import { HaloView } from './view.js';
import { PlaybackSession, ScreenAwake } from './mobile.js';

const $ = (id) => document.getElementById(id);
const time = () => performance.now() / 1000;
const PREF_KEY = 'halo-autonomous.settings.v1';
let config = settings(DEFAULTS);
try { config = settings(JSON.parse(localStorage.getItem(PREF_KEY)) || DEFAULTS); } catch { /* 保存できなくても利用できる */ }
const gate = new SessionGate();
const playback = new PlaybackSession(navigator, () => {
  if (gate.state === 'running' || gate.state === 'starting') stop('ほかの音声処理で中断されたため停止しました。', 'paused');
});
const screen = new ScreenAwake(navigator,
  () => config.keepAwake && gate.state === 'running' && !document.hidden, renderMobile);
const view = new HaloView($('spectrum'), $('geometry'), $('dial-labels'));
let audio = null, planner = null, timer = null, lastTick = 0, lastFrame = 0;
let recent = [], trace = null, count = 0, mute = false;
let frameHandle = null;
let preset = 'breath';
const PRESETS = {
  quiet: { density: 0.3, description: '少ない音と長い余韻。静けさを聴くための、凪。' },
  breath: { density: 0.65, description: 'ゆったりした呼吸に、和音と煌めきが寄り添います。' },
  stars: { density: 1, description: '高い音が少し多めに。星明かりのような、小さな出会い。' },
};

function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(config)); } catch { /* 任意の保存 */ } }

function renderMobile() {
  $('media-playback').checked = config.mediaPlayback;
  $('media-playback').disabled = !playback.supported;
  $('keep-awake').checked = config.keepAwake;
  $('keep-awake').disabled = !screen.supported;
  $('playback-status').textContent = playback.state === 'restore-failed' ? '音声設定を元に戻せたか確認できません。'
    : !playback.supported ? 'このブラウザーでは通常の音声設定で再生します。'
    : playback.state === 'unavailable' ? '音楽用の設定を利用できません。通常の音声設定で再生します。'
    : config.mediaPlayback ? '対応端末ではマナーモード中も再生します。他の音楽が止まる場合があります。'
    : 'ブラウザーの通常の音声設定で再生します。';
  const states = {
    active: '再生中だけ、画面が自動で消えないようにしています。',
    requesting: '画面点灯の維持を要求しています。',
    releasing: '画面点灯の維持を解除しています。',
    unavailable: '画面点灯を維持できません。画面が消えると停止します。',
    released: '端末が画面点灯の維持を解除しました。画面が消えると停止します。',
    'release-failed': '画面点灯の維持を解除できたか確認できません。',
  };
  $('wake-status').textContent = states[screen.state] ?? (!screen.supported
    ? 'このブラウザーは画面点灯の維持に対応していません。'
    : '再生中のみ有効です。画面を離れたら音は停止し、自動で再開しません。');
}

function renderConfig() {
  for (const key of ['world', 'tuning', 'tonic', 'a4', 'minutes']) $(key).value = config[key];
  $('volume').value = Math.round(config.volume * 100);
  $('volume-value').textContent = mute ? '消音' : `${Math.round(config.volume * 100)}%`;
  $('density').value = Math.round(config.density * 100);
  $('density-value').textContent = config.density < 0.45 ? 'まばらに' : config.density > 0.8 ? '豊かに' : 'ほどよく';
  $('trail').value = Math.round(config.trail * 10);
  $('trail-value').textContent = `${config.trail.toFixed(1)}秒`;
  for (const layer of Object.keys(config.layers)) $(`layer-${layer}`).checked = config.layers[layer];
  $('world-badge').textContent = WORLDS[config.world].name;
  $('world-description').textContent = WORLDS[config.world].description;
  for (const button of document.querySelectorAll('[data-preset]')) button.setAttribute('aria-pressed', String(button.dataset.preset === preset));
  $('preset-description').textContent = PRESETS[preset]?.description ?? '音の重なりを、好みの密度にととのえています。';
  renderMobile();
  queueFrame();
}

function renderState() {
  const running = gate.state === 'running', starting = gate.state === 'starting';
  $('state-label').textContent = running ? '自律生成中' : starting ? '音を準備しています' : gate.state === 'idle' ? '開始を待っています' : '停止中';
  $('status-dot').classList.toggle('running', running);
  $('session-message').textContent = gate.state === 'idle' ? '小さな音から、ゆっくり始まります。' : gate.reason;
  $('start').disabled = running || starting;
  $('stop').disabled = !running && !starting;
  $('start-label').textContent = gate.state === 'idle' ? 'はじめる' : starting ? '準備中…' : running ? '生成しています' : 'もう一度、はじめる';
  $('center-glyph').textContent = running ? '息' : '静';
  $('center-caption').textContent = running ? 'とめる' : starting ? '準備中' : 'はじめる';
  $('center-button').disabled = starting;
  $('center-button').setAttribute('aria-label', running ? '自律生成を停止する' : '自律生成をはじめる');
  $('visual-caption').textContent = running ? '音の高さが向きになり、和音が光の骨格になります。'
    : gate.state === 'idle' ? '待機中は和音の見本。開始すると、音に光が重なります。' : '静けさに戻りました。再開は、はじめるボタンから。';
  queueFrame();
}

function renderNotes(now) {
  for (const layer of Object.keys(config.layers)) {
    const notes = recent.filter((event) => event.layer === layer && now < event.at + event.duration);
    const lastAt = notes.at(-1)?.at;
    $(`note-${layer}`).textContent = notes.filter((event) => event.at === lastAt).map((event) => view.noteText(event.hz)).join('・') || '—';
  }
  const seconds = Math.floor(gate.elapsed);
  $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('note-count').textContent = `${count} 音を生成`;
}

function stop(reason = '停止しました。再開は、はじめるボタンから。', state = 'stopped') {
  gate.stop(reason, state);
  if (timer !== null) clearInterval(timer);
  timer = null;
  const previous = audio;
  audio = null;
  planner = null;
  recent = [];
  view.reset();
  if (trace) { trace.endReason = reason; trace.elapsed = gate.elapsed; }
  renderState(); renderNotes(time());
  if (previous) void previous.close().catch(() => {
    $('session-message').textContent = '音の出口は閉じましたが、音声処理の終了を確認できませんでした。';
  });
  playback.stop();
  void screen.release();
  renderMobile();
}

function tick() {
  if (gate.state !== 'running' || !audio || !planner) return;
  const now = time(), observed = audio.observe();
  const reason = gate.observe({ now, lastTick, audioState: observed.state, peak: observed.peak, voices: observed.voices, minutes: config.minutes });
  if (reason) { stop(reason, 'paused'); return; }
  lastTick = now;
  try {
    const events = planner.advance(now);
    for (const event of events) {
      if (!audio.play(event)) throw new Error('発音を確認できませんでした');
      count++;
      if (trace) {
        trace.events.push({ ...event, at: Math.round((event.at - gate.startedAt) * 1000) / 1000 });
        trace.events = trace.events.slice(-256);
        trace.totalEvents = count;
      }
    }
    recent.push(...events); recent = recent.filter((event) => now < event.at + event.duration).slice(-48);
    view.add(events);
    audio.keepAlive();
    renderNotes(now);
  } catch { stop('音の生成を確認できないため停止しました。', 'paused'); }
}

async function start() {
  if (document.hidden) return;
  const revision = gate.begin(time());
  if (revision === null) return;
  renderState();
  const candidate = new AmbientAudio();
  audio = candidate;
  try {
    playback.start(config.mediaPlayback);
    renderMobile();
    if (gate.revision !== revision) { await candidate.close(); return; }
    const opened = await candidate.open(config);
    if (!opened || document.hidden || !gate.confirm(revision)) {
      await candidate.close();
      if (gate.revision === revision && gate.state === 'starting') stop('画面が変わったため停止しました。', 'paused');
      return;
    }
    candidate.setMuted(mute);
    // 開始時点を、実際に音声処理が使えるようになった時刻へ合わせる。
    gate.startedAt = time(); gate.elapsed = 0;
    const seed = Array.from(crypto.getRandomValues(new Uint32Array(2))).map((n) => n.toString(16)).join('-');
    planner = new AmbientPlanner(config, seed, gate.startedAt);
    trace = { format: 'halo-autonomous.trace.v1', seed, settings: structuredClone(config), totalEvents: 0, events: [], endReason: null };
    count = 0; recent = [];
    view.reset('running');
    view.configure(config, candidate.context.sampleRate);
    candidate.context.addEventListener('statechange', () => {
      if (audio === candidate && gate.state === 'running' && candidate.context.state !== 'running') stop('音声処理が中断されたため停止しました。', 'paused');
    });
    lastTick = time();
    tick();
    if (gate.state === 'running') {
      timer = setInterval(tick, 250);
      if (config.keepAwake) void screen.request();
    }
    renderState();
  } catch {
    if (gate.revision === revision) stop('音を開始できませんでした。対応ブラウザーで、もう一度開始してください。', 'paused');
    await candidate.close().catch(() => {});
  }
}

$('start').addEventListener('click', () => void start());
$('stop').addEventListener('click', () => stop());
$('center-button').addEventListener('click', () => gate.state === 'running' ? stop() : void start());
$('mute').addEventListener('click', () => {
  mute = !mute; audio?.setMuted(mute);
  $('mute').setAttribute('aria-pressed', String(mute));
  $('mute').setAttribute('aria-label', mute ? '消音を解除する' : '消音して光だけにする');
  $('mute').textContent = mute ? '消音中' : '音量';
  renderConfig();
});

for (const key of ['world', 'tuning', 'tonic', 'a4']) $(key).addEventListener('change', () => {
  if (gate.state === 'running' || gate.state === 'starting') stop('音の設定を変えたため停止しました。新しい音階で、もう一度はじめられます。');
  config = settings({ ...config, [key]: $(key).value });
  view.configure(config); view.reset(gate.state === 'idle' ? 'idle' : 'stopped');
  renderConfig(); savePrefs();
});
$('minutes').addEventListener('change', () => { config = settings({ ...config, minutes: $('minutes').value }); savePrefs(); });
$('media-playback').addEventListener('change', () => {
  const enabled = $('media-playback').checked;
  if (gate.state === 'running' || gate.state === 'starting') stop('音声設定を変えたため停止しました。もう一度はじめると反映します。');
  config = settings({ ...config, mediaPlayback: enabled });
  renderMobile(); savePrefs();
});
$('keep-awake').addEventListener('change', () => {
  config = settings({ ...config, keepAwake: $('keep-awake').checked });
  if (!config.keepAwake) void screen.release();
  else if (gate.state === 'running') void screen.request();
  renderMobile(); savePrefs();
});
$('volume').addEventListener('input', () => {
  config = settings({ ...config, volume: Number($('volume').value) / 100 });
  audio?.setVolume(config.volume); renderConfig(); savePrefs();
});
$('density').addEventListener('input', () => {
  config = settings({ ...config, density: Number($('density').value) / 100 }); preset = '';
  if (planner) planner.config = settings(config);
  renderConfig(); savePrefs();
});
$('trail').addEventListener('input', () => {
  config = settings({ ...config, trail: Number($('trail').value) / 10 });
  view.trail = config.trail;
  renderConfig(); savePrefs();
});
for (const layer of Object.keys(config.layers)) $(`layer-${layer}`).addEventListener('change', () => {
  config = settings({ ...config, layers: { ...config.layers, [layer]: $(`layer-${layer}`).checked } });
  view.layers = config.layers;
  if (planner) { planner.config = settings(config); planner.next[layer] = time(); }
  if (!config.layers[layer]) {
    audio?.silenceLayer(layer);
    recent = recent.filter((event) => event.layer !== layer);
    view.events = view.events.filter((event) => event.layer !== layer);
  }
  renderNotes(time()); queueFrame(); savePrefs();
});
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => {
  preset = button.dataset.preset;
  config = settings({ ...config, density: PRESETS[preset].density });
  if (planner) planner.config = settings(config);
  renderConfig(); savePrefs();
});

$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
$('save-record').addEventListener('click', () => {
  const record = trace ? { ...trace, elapsed: gate.elapsed, state: gate.state, savedAt: new Date().toISOString() }
    : { format: 'halo-autonomous.trace.v1', settings: config, state: gate.state, totalEvents: 0, events: [] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `halo-${new Date().toISOString().replaceAll(':', '-')}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (gate.state === 'running' || gate.state === 'starting')) stop('画面を離れたため停止しました。再開は、はじめるボタンから。', 'paused');
});
window.addEventListener('pagehide', () => stop('ページを閉じたため停止しました。'));
window.addEventListener('error', () => { if (gate.state === 'running' || gate.state === 'starting') stop('画面の処理を確認できないため停止しました。', 'paused'); });
window.addEventListener('unhandledrejection', () => { if (gate.state === 'running' || gate.state === 'starting') stop('処理が中断したため停止しました。', 'paused'); });
const observer = new ResizeObserver(() => { view.resize(); queueFrame(); }); observer.observe($('mandala'));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function queueFrame() { if (frameHandle === null) frameHandle = requestAnimationFrame(frame); }
function frame(ms) {
  frameHandle = null;
  const interval = reduceMotion.matches ? 100 : 1000 / 30;
  if (gate.state !== 'running' || ms - lastFrame >= interval) {
    view.frame(audio, time(), lastFrame ? ms - lastFrame : interval, gate.state === 'running');
    lastFrame = ms;
  }
  if (gate.state === 'running') queueFrame();
}

preset = Object.entries(PRESETS).find(([, value]) => Math.abs(value.density - config.density) < 0.01)?.[0] ?? '';
view.configure(config); renderConfig(); renderState();
queueFrame();
