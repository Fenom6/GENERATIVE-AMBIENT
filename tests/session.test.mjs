import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionGate } from '../dist/js/session.js';

test('stop while starting invalidates delayed audio completion', () => {
  const gate = new SessionGate(), pending = gate.begin(10);
  gate.stop('利用者の停止');
  assert.equal(gate.confirm(pending), false); assert.equal(gate.state, 'stopped');
  for (let i = 0; i < 10; i++) gate.observe({ now: 100 + i });
  assert.equal(gate.state, 'stopped');
  const explicit = gate.begin(120);
  assert.equal(gate.confirm(pending), false); assert.equal(gate.confirm(explicit), true);
});

test('all interruption paths return a stop reason and never grant automatic resume', () => {
  const valid = { now: 10.25, lastTick: 10, audioState: 'running', peak: 0.1, voices: 7, minutes: 15 };
  const cases = [{ now: 13 }, { now: 9 }, { audioState: 'suspended' }, { peak: NaN }, { voices: Infinity }, { voices: 17 }, { peak: 0.99 }];
  for (const change of cases) {
    const gate = new SessionGate(); gate.confirm(gate.begin(10));
    const reason = gate.observe({ ...valid, ...change }); assert.ok(reason);
    gate.stop(reason, 'paused'); assert.equal(gate.confirm(gate.revision - 1), false);
    assert.equal(gate.observe(valid), null); assert.equal(gate.state, 'paused');
  }
});

test('session timer ends once, while explicitly unbounded sessions retain the guard', () => {
  const gate = new SessionGate(); gate.confirm(gate.begin(0));
  assert.equal(gate.observe({ now: 299, lastTick: 298.75, audioState: 'running', peak: 0, voices: 0, minutes: 5 }), null);
  assert.ok(gate.observe({ now: 300, lastTick: 299.75, audioState: 'running', peak: 0, voices: 0, minutes: 5 }));
  assert.equal(gate.observe({ now: 10000, lastTick: 9999.75, audioState: 'running', peak: 0, voices: 0, minutes: 0 }), null);
  assert.ok(gate.observe({ now: 10003, lastTick: 10000, audioState: 'running', peak: 0, voices: 0, minutes: 0 }));
});
