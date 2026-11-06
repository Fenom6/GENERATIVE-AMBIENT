/** 停止を保持する状態機械。非同期の音声準備が後から終わっても停止を覆さない。 */
export class SessionGate {
  constructor() {
    this.state = 'idle';
    this.reason = '開始を待っています';
    this.revision = 0;
    this.startedAt = 0;
    this.elapsed = 0;
  }

  begin(now) {
    if (this.state === 'running' || this.state === 'starting') return null;
    this.state = 'starting';
    this.reason = '音を準備しています';
    this.startedAt = now;
    this.elapsed = 0;
    return ++this.revision;
  }

  confirm(revision) {
    if (revision !== this.revision || this.state !== 'starting') return false;
    this.state = 'running';
    this.reason = '3つの周期が、少しずつ重なります';
    return true;
  }

  stop(reason = '停止しました', state = 'stopped') {
    ++this.revision;
    this.state = state;
    this.reason = reason;
  }

  observe({ now, lastTick, audioState, peak, voices, minutes }) {
    if (this.state !== 'running') return null;
    if (![now, lastTick, peak, voices].every(Number.isFinite)) return '観測値を確認できないため停止しました';
    this.elapsed = Math.max(0, now - this.startedAt);
    if (now < lastTick || now - lastTick > 2) return '処理が途切れたため停止しました';
    if (audioState !== 'running') return '音声処理が中断されたため停止しました';
    if (voices > 16) return '同時に鳴る音の上限に達したため停止しました';
    if (peak >= 0.98) return '音の出力が大きすぎるため停止しました';
    if (minutes > 0 && this.elapsed >= minutes * 60) return '設定した時間になりました';
    return null;
  }
}
