import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientPlanner, hzMidi, intervalRatio, settings } from '../dist/js/music.js';
import { HaloView } from '../dist/js/view.js';
import { midiToTurn, spiralPoint } from '../dist/vendor/halo/kouhai.js';

// 描画先だけを置き換え、音の位置と軌跡は実際の描画コードで計算する。
function canvas() {
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
  return { clientWidth: 400, clientHeight: 400, getContext: () => context };
}
function drawing(t, config) {
  const original = Object.fromEntries(['document', 'window', 'Path2D'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    document: { createElement: (tag) => tag === 'canvas' ? canvas() : { style: {} } },
    window: { devicePixelRatio: 1 },
    Path2D: class { moveTo() {} lineTo() {} },
  });
  t.after(() => { for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const result = new HaloView(canvas(), canvas(), { replaceChildren() {}, append() {} });
  result.configure(config);
  return result;
}

test('all tonic/root positions align with the actual spiral, including F/F sharp fifths', (t) => {
  const view = drawing(t, settings());
  for (const a4 of [415, 432, 440, 466]) for (const tuning of ['just', 'equal']) for (let tonic = 0; tonic < 12; tonic++) {
    const config = settings({ tonic, tuning, a4 });
    view.configure(config);
    const planner = new AmbientPlanner(config, 'positions');
    for (const offset of [0, 5, 7]) {
      planner.rootOffset = offset;
      const midi = hzMidi(planner.rootHz()), turn = midiToTurn(midi);
      const expectedTurn = Math.log2(intervalRatio(offset, tuning));
      assert.ok(Math.abs(turn - expectedTurn) < 1e-9, `${tonic}/${tuning}/${offset}/${a4}: ${turn}`);
      const expected = spiralPoint(expectedTurn, view.view.size), actual = view.point(midi);
      assert.ok(Math.hypot(actual.x - view.view.cx - expected.x, actual.y - view.view.cy - expected.y) < 1e-6);
    }
  }
});

for (const fps of [10, 20, 30]) test(`two-second visual trail expires at ${fps} frames/sec`, (t) => {
  const config = settings({ trail: 2 }), view = drawing(t, config);
  view.reset('running');
  view.add([{ layer: 'drone', midi: 60, at: 0, duration: 20 }]);
  for (let frame = 0; frame <= 5 * fps; frame++) view.frame(null, frame / fps, 1000 / fps, true);
  const samples = view.view.orbs[0].trail.length / 2;
  assert.ok(samples >= fps * 2 - 1 && samples <= fps * 2 + 1, `${samples} samples represent ${samples / fps} seconds`);
});

test('trail adapts to irregular frames and a live change in duration', (t) => {
  const config = settings({ trail: 3 }), view = drawing(t, config);
  view.reset('running'); view.add([{ layer: 'drone', midi: 60, at: 0, duration: 20 }]);
  let now = 0;
  const times = [];
  for (let frame = 0; frame < 150; frame++) {
    const dt = [100, 33, 50, 80][frame % 4]; now += dt / 1000; times.push(now);
    if (frame === 100) view.trail = 1.2;
    view.frame(null, now, dt, true);
    if (frame >= 100) assert.ok(view.view.orbs[0].trail.length / 2 <= times.filter((at) => now - at < 1.2 + 1e-9).length);
  }
  view.reset(); assert.equal(view.view.orbs[0].trail.length, 0);
});
