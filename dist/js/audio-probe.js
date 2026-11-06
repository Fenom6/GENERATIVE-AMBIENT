import { AmbientAudio } from './audio.js';

async function renderScenario(manualStop) {
  const offline = new OfflineAudioContext(2, 48000 * 3, 48000);
  // 同じ発音回路を、スピーカーではなく計算用の音声処理へ接続する。
  const proxy = new Proxy(offline, {
    get(target, key) {
      if (key === 'state') return 'running';
      if (key === 'resume' || key === 'close') return async () => {};
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  class Context { constructor() { return proxy; } }
  const audio = new AmbientAudio(Context);
  await audio.open({ volume: 0.5 });
  audio.keepAlive();
  audio.play({ id: 1, layer: 'drone', hz: 130.8128, duration: 3 });
  audio.play({ id: 2, layer: 'harmony', hz: 327.032, duration: 2.8 });
  audio.play({ id: 3, layer: 'sparkle', hz: 1046.502, duration: 2.8 });
  let stopped = Promise.resolve();
  if (manualStop) stopped = offline.suspend(0.5).then(async () => { await audio.close(); await offline.resume(); });
  const buffer = await offline.startRendering(); await stopped;
  const channel = buffer.getChannelData(0);
  let before = 0, after = 0, bad = 0;
  const cutoff = manualStop ? 0.6 : 1.5;
  for (let i = 0; i < channel.length; i++) {
    const value = Math.abs(channel[i]);
    if (!Number.isFinite(value)) bad++;
    if (i > 0.05 * 48000 && i < 0.4 * 48000) before = Math.max(before, value);
    if (i > cutoff * 48000) after = Math.max(after, value);
  }
  const passed = before > 0.00001 && after < 0.000001 && bad === 0;
  return { scenario: manualStop ? '手動停止後の発音・残響の遮断' : '処理が止まった場合の1.4秒以内の出力遮断', passed, beforePeak: before, afterPeak: after, invalidSamples: bad };
}

document.getElementById('run-probe').addEventListener('click', async () => {
  const button = document.getElementById('run-probe'), result = document.getElementById('probe-result');
  button.disabled = true; result.textContent = '音声波形を計算しています…';
  try {
    const outcomes = [await renderScenario(false), await renderScenario(true)];
    result.textContent = outcomes.every((item) => item.passed) ? 'PASS — 2件の音声停止試験に成功しました' : 'FAIL — 音声停止試験に未達があります';
    document.getElementById('probe-details').textContent = JSON.stringify(outcomes, null, 2);
  } catch (error) { result.textContent = `FAIL — ${error.message}`; }
  button.disabled = false;
});
