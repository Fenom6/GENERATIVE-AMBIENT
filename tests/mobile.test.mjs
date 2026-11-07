import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackSession, ScreenAwake } from '../dist/js/mobile.js';

function sentinel() {
  const result = new EventTarget();
  result.released = false;
  result.releases = 0;
  result.release = async () => {
    result.releases++;
    result.released = true;
    result.dispatchEvent(new Event('release'));
  };
  return result;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('audio mode is optional and restores the previous mode after stop', () => {
  const session = Object.assign(new EventTarget(), { type: 'ambient', state: 'active' });
  let interrupted = 0;
  const playback = new PlaybackSession({ audioSession: session }, () => interrupted++);
  playback.start(false); assert.equal(session.type, 'ambient');
  playback.start(true); assert.equal(session.type, 'playback');
  session.state = 'interrupted'; session.dispatchEvent(new Event('statechange'));
  assert.equal(interrupted, 1);
  playback.stop(); assert.equal(session.type, 'ambient');
  session.dispatchEvent(new Event('statechange')); assert.equal(interrupted, 1);
  playback.stop(); assert.equal(session.type, 'ambient');
});

test('unsupported or rejected audio modes do not throw or overwrite another owner', () => {
  const missing = new PlaybackSession({}); missing.start(true); assert.equal(missing.state, 'unsupported');
  const broken = new PlaybackSession({ audioSession: { get type() { return 'auto'; }, set type(_) { throw Error('denied'); } } });
  assert.doesNotThrow(() => broken.start(true)); assert.equal(broken.state, 'unavailable'); broken.stop();
  const session = { type: 'auto' }, playback = new PlaybackSession({ audioSession: session });
  playback.start(true); session.type = 'transient'; playback.stop(); assert.equal(session.type, 'transient');
});

test('wake lock is requested only during allowed playback and released on stop', async () => {
  let allowed = false, calls = 0;
  const lock = sentinel();
  const screen = new ScreenAwake({ wakeLock: { request: async (kind) => { assert.equal(kind, 'screen'); calls++; return lock; } } }, () => allowed);
  assert.equal(await screen.request(), false); assert.equal(calls, 0);
  allowed = true; assert.equal(await screen.request(), true); assert.equal(screen.state, 'active');
  assert.equal(await screen.request(), true); assert.equal(calls, 1);
  allowed = false; assert.equal(await screen.release(), true);
  assert.equal(lock.released, true); assert.equal(screen.lock, null); assert.equal(screen.state, 'idle');
});

test('permission arriving after stop or opt-out is released without reacquiring', async () => {
  const request = deferred(), lock = sentinel(); let calls = 0, allowed = true;
  const screen = new ScreenAwake({ wakeLock: { request: () => { calls++; return request.promise; } } }, () => allowed);
  const pending = screen.request();
  allowed = false; await screen.release(); request.resolve(lock);
  assert.equal(await pending, false); assert.equal(lock.released, true); assert.equal(screen.lock, null);
  allowed = true; assert.equal(calls, 1); assert.equal(screen.state, 'idle');
});

test('a late old request cannot release or replace the new session lock', async () => {
  const first = deferred(), second = deferred(), old = sentinel(), current = sentinel();
  let calls = 0;
  const screen = new ScreenAwake({ wakeLock: { request: () => ++calls === 1 ? first.promise : second.promise } }, () => true);
  const oldRequest = screen.request(); await screen.release();
  const newRequest = screen.request(); second.resolve(current); assert.equal(await newRequest, true);
  first.resolve(old); assert.equal(await oldRequest, false);
  assert.equal(old.released, true); assert.equal(current.released, false); assert.equal(screen.lock, current);
  await screen.release(); assert.equal(current.released, true);
});

test('unsupported, denied or system-released wake locks do not retry automatically', async () => {
  const missing = new ScreenAwake({}, () => true); assert.equal(await missing.request(), false); assert.equal(missing.state, 'unsupported');
  let calls = 0;
  const denied = new ScreenAwake({ wakeLock: { request: async () => { calls++; throw Error('NotAllowedError'); } } }, () => true);
  assert.equal(await denied.request(), false); assert.equal(denied.state, 'unavailable'); assert.equal(calls, 1);
  const lock = sentinel();
  const screen = new ScreenAwake({ wakeLock: { request: async () => { calls++; return lock; } } }, () => true);
  await screen.request(); await lock.release();
  assert.equal(screen.state, 'released'); assert.equal(screen.lock, null); assert.equal(calls, 2);
  await screen.release(); assert.equal(lock.releases, 1);
});

test('failed wake release is reported and retained for a later explicit release', async () => {
  const lock = sentinel(), release = lock.release;
  lock.release = async () => { throw Error('failed'); };
  const screen = new ScreenAwake({ wakeLock: { request: async () => lock } }, () => true);
  await screen.request(); assert.equal(await screen.release(), false);
  assert.equal(screen.state, 'release-failed'); assert.equal(screen.owned.has(lock), true);
  lock.release = release; assert.equal(await screen.release(), true); assert.equal(lock.released, true);
});

test('release stays pending until confirmed and its completion cannot overwrite a new session', async () => {
  const old = sentinel(), current = sentinel(), completion = deferred(); let calls = 0;
  const releaseOld = old.release;
  old.release = async () => { await completion.promise; await releaseOld(); };
  const screen = new ScreenAwake({ wakeLock: { request: async () => ++calls === 1 ? old : current } }, () => true);
  await screen.request();
  const stopping = screen.release(); assert.equal(screen.state, 'releasing');
  await screen.request(); assert.equal(screen.state, 'active');
  completion.resolve(); assert.equal(await stopping, true);
  assert.equal(screen.state, 'active'); assert.equal(screen.lock, current); assert.equal(current.released, false);
  await screen.release();
});

test('a resolved release without a released flag is not reported as confirmed', async () => {
  const lock = sentinel();
  lock.release = async () => {};
  const screen = new ScreenAwake({ wakeLock: { request: async () => lock } }, () => true);
  await screen.request();
  assert.equal(await screen.release(), false);
  assert.equal(screen.state, 'release-failed'); assert.equal(screen.owned.has(lock), true);
});
