import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientAudio, WATCHDOG_SECONDS } from '../dist/js/audio.js';

class Param {
  constructor() { this.value = 0; this.events = []; }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); }
  setValueAtTime(value, at) { this.events.push(['set', value, at]); }
  linearRampToValueAtTime(value, at) { this.events.push(['linear', value, at]); }
  exponentialRampToValueAtTime(value, at) { this.events.push(['exp', value, at]); }
  setTargetAtTime(value, at, constant) { this.events.push(['target', value, at, constant]); }
}
class Node {
  constructor() {
    for (const key of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'pan']) this[key] = new Param();
    this.frequencyBinCount = 8192;
  }
  connect(next) { return next; }
  disconnect() { this.disconnected = true; }
  setPeriodicWave() {}
  start(at) { this.started = at; }
  stop(at) { this.stopped = at; }
  getFloatTimeDomainData(array) { array.fill(0); }
  getFloatFrequencyData(array) { array.fill(-100); }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = new Node(); }
  createGain() { return new Node(); } createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); } createAnalyser() { return new Node(); }
  createConvolver() { return new Node(); } createOscillator() { return new Node(); }
  createStereoPanner() { return new Node(); } createPeriodicWave() { return {}; }
  createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
  async resume() {}
  async close() { this.state = 'closed'; }
}
const note = (id = 1) => ({ id, layer: 'harmony', hz: 330, duration: 6 });

test('closing cancels the watchdog and volume automation, stops voices and disconnects output', async () => {
  const audio = new AmbientAudio(Context); await audio.open(); audio.keepAlive(); audio.play(note());
  const voice = audio.voices.get(1), watchdog = audio.watchdog, volume = audio.volumeNode;
  await audio.close();
  assert.equal(audio.closed, true); assert.equal(audio.context.state, 'closed'); assert.equal(audio.voices.size, 0);
  assert.equal(voice.oscillator.stopped, 0); assert.equal(voice.oscillator.disconnected, true);
  assert.deepEqual(watchdog.gain.events.slice(-2), [['cancel', 0], ['set', 0, 0]]);
  assert.deepEqual(volume.gain.events.slice(-2), [['cancel', 0], ['set', 0, 0]]);
  assert.equal(audio.output.disconnected, true); assert.equal(audio.play(note()), false);
});

test('watchdog expires without a main-thread heartbeat and invalid notes cannot allocate voices', async () => {
  const audio = new AmbientAudio(Context); await audio.open(); audio.keepAlive();
  assert.deepEqual(audio.watchdog.gain.events.at(-1), ['linear', 0, WATCHDOG_SECONDS]);
  for (const invalid of [{ hz: NaN }, { hz: 100000 }, { duration: Infinity }, { duration: 24 }, { layer: 'unknown' }]) {
    assert.throws(() => audio.play({ ...note(), ...invalid })); assert.equal(audio.voices.size, 0);
  }
  for (let i = 0; i < 16; i++) audio.play(note(i));
  assert.throws(() => audio.play(note(17)), /上限/); assert.equal(audio.voices.size, 16);
  await audio.close();
});

test('a closed pending context never reports a successful open', async () => {
  let resolveResume;
  class PendingContext extends Context { resume() { return new Promise((resolve) => { resolveResume = resolve; }); } }
  const audio = new AmbientAudio(PendingContext), pending = audio.open();
  await audio.close(); resolveResume();
  assert.equal(await pending, false); assert.equal(audio.context.state, 'closed');
});

test('volume caps remain effective and mute preserves the selected volume', async () => {
  const audio = new AmbientAudio(Context); await audio.open({ volume: 10 }); assert.equal(audio.volume, 0.5);
  audio.setMuted(true); assert.equal(audio.volumeNode.gain.events.at(-1)[1], 0);
  audio.setVolume(0.2); assert.equal(audio.volumeNode.gain.events.at(-1)[1], 0);
  audio.setMuted(false); assert.equal(audio.volumeNode.gain.events.at(-1)[1], 0.2);
  await audio.close();
});
