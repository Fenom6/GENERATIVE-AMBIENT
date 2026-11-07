import test from 'node:test';
import assert from 'node:assert/strict';
import { AmbientPlanner, DEFAULTS, WORLDS, intervalRatio, settings, midiHz } from '../dist/js/music.js';
import { baseMidi } from '../dist/vendor/halo/tuning.js';

test('same seed and clock reproduce decisions; different seeds diverge', () => {
  const run = (seed) => {
    const planner = new AmbientPlanner({}, seed);
    return Array.from({ length: 1000 }, (_, i) => planner.advance(i / 4)).flat();
  };
  assert.deepEqual(run('same'), run('same'));
  assert.notDeepEqual(run('same'), run('different'));
});

test('just thirds/fifths are integer ratios; quarter tones retain their position', () => {
  assert.equal(intervalRatio(4), 5 / 4);
  assert.equal(intervalRatio(7), 3 / 2);
  assert.equal(intervalRatio(19), 3);
  assert.equal(intervalRatio(3.5), 2 ** (3.5 / 12));
  assert.equal(intervalRatio(4, 'equal'), 2 ** (4 / 12));
});

test('eight hours of all worlds, tunings, and tonics remain inside voice and pitch bounds', () => {
  for (const world of Object.keys(WORLDS)) for (const tuning of ['just', 'equal']) for (const tonic of [0, 6, 11]) {
    const config = settings({ world, tuning, tonic, a4: tonic === 11 ? 415 : 442, density: 1 });
    const planner = new AmbientPlanner(config, `${world}/${tuning}/${tonic}`);
    let sounding = [], roots = new Set(), total = 0;
    for (let now = 0; now < 8 * 3600; now += 0.25) {
      const events = planner.advance(now);
      sounding = sounding.filter((event) => now <= event.at + event.duration + 0.06);
      sounding.push(...events);
      assert.ok(sounding.length <= 16, `voice budget: ${sounding.length}`);
      for (const event of events) {
        const lowRoot = baseMidi(config.tonic);
        const [low, high] = { drone: [lowRoot, lowRoot + 12], harmony: [48, 72], sparkle: [72, 96] }[event.layer];
        assert.ok(event.hz >= midiHz(low, config.a4) - 1e-6 && event.hz <= midiHz(high, config.a4) + 1e-6, `${event.layer} pitch ${event.hz}`);
        assert.ok(Number.isFinite(event.hz) && event.duration > 0 && event.duration <= 22);
        roots.add(event.rootOffset); total++;
      }
    }
    assert.equal(roots.size, 3); assert.ok(total > 1000);
  }
});

test('breath, harmony and sparkle retain separate requested timing ranges', () => {
  const planner = new AmbientPlanner({ density: 1 }, 'timing');
  const prior = {};
  for (let now = 0; now < 115; now += 0.01) for (const event of planner.advance(now)) {
    if (prior[event.layer] !== undefined && prior[event.layer] !== event.at) {
      const [min, max] = { drone: [12, 20], harmony: [4, 8], sparkle: [2, 6] }[event.layer];
      const gap = event.at - prior[event.layer];
      assert.ok(gap >= min - 0.011 && gap <= max + 0.011, `${event.layer}: ${gap}`);
    }
    prior[event.layer] = event.at;
  }
});

test('world settings affect generated notes, including real fractional quarter tones', () => {
  const all = {};
  for (const world of Object.keys(WORLDS)) {
    const planner = new AmbientPlanner({ world, density: 1, tuning: 'equal' }, 'world');
    const notes = [];
    for (let now = 0; now < 100; now += 0.25) notes.push(...planner.advance(now));
    for (const event of notes.filter((event) => event.layer !== 'drone')) assert.ok(WORLDS[world].notes.includes(event.interval));
    all[world] = notes;
  }
  assert.ok(all.arab.some((event) => event.interval % 1 !== 0));
  assert.ok(all.pentatonic.every((event) => event.interval % 1 === 0));
  assert.notDeepEqual(all.india, all.pentatonic);
});

test('disabled layers generate no events; long gaps produce no backlog burst', () => {
  const silent = new AmbientPlanner({ layers: { drone: false, harmony: false, sparkle: false } });
  for (let now = 0; now < 1000; now++) assert.deepEqual(silent.advance(now), []);
  const planner = new AmbientPlanner({ density: 1 }, 'gap');
  planner.advance(0);
  assert.ok(planner.advance(100000).length <= 4);
  assert.deepEqual(planner.advance(100000), []);
});

test('untrusted stored preferences cannot expand generation bounds', () => {
  const config = settings({ world: '__proto__', volume: 99, a4: 10000, tonic: -50, trail: 500, density: -1, minutes: 999, layers: { drone: 'true' } });
  assert.equal(config.world, DEFAULTS.world); assert.equal(config.volume, 0.5); assert.equal(config.a4, 466);
  assert.equal(config.tonic, 0); assert.equal(config.trail, 3); assert.equal(config.density, 0.2);
  assert.equal(config.minutes, 15); assert.equal(config.layers.drone, true);
});

test('screen wake is opt-in, while mobile choices survive validated preference loading', () => {
  assert.equal(settings().keepAwake, false);
  assert.equal(settings({ keepAwake: 'true' }).keepAwake, false);
  assert.equal(settings({ keepAwake: true }).keepAwake, true);
  assert.equal(settings({ mediaPlayback: false }).mediaPlayback, false);
});
