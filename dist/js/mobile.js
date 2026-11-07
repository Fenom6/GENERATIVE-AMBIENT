/** 端末の音声設定は再生中だけ借り、停止時に元へ戻す。未対応端末では何もしない。 */
export class PlaybackSession {
  constructor(navigator, onInterrupted = () => {}) {
    this.navigator = navigator;
    this.onInterrupted = onInterrupted;
    this.session = null;
    this.state = 'idle';
  }

  get supported() {
    try { return typeof this.navigator?.audioSession?.type === 'string'; } catch { return false; }
  }

  start(enabled) {
    this.stop();
    if (!enabled) return;
    if (!this.supported) { this.state = 'unsupported'; return; }
    try {
      const session = this.navigator.audioSession;
      this.previousType = session.type;
      this.session = session;
      session.type = 'playback';
      this.state = session.type === 'playback' ? 'active' : 'unavailable';
      this.listener = () => {
        if (this.session === session && session.state === 'interrupted') this.onInterrupted();
      };
      session.addEventListener?.('statechange', this.listener);
    } catch { this.state = 'unavailable'; }
  }

  stop() {
    const session = this.session;
    this.session = null;
    this.state = 'idle';
    if (!session) return;
    try {
      session.removeEventListener?.('statechange', this.listener);
      if (session.type === 'playback') {
        session.type = this.previousType;
        if (session.type !== this.previousType) this.state = 'restore-failed';
      }
    } catch { this.state = 'restore-failed'; }
  }
}

/** 画面点灯の維持。遅れて許可されても、停止済みなら直ちに解除する。 */
export class ScreenAwake {
  constructor(navigator, allowed, onChange = () => {}) {
    this.navigator = navigator;
    this.allowed = allowed;
    this.onChange = onChange;
    this.revision = 0;
    this.lock = null;
    this.owned = new Set();
    this.state = 'idle';
  }

  get supported() {
    try { return typeof this.navigator?.wakeLock?.request === 'function'; } catch { return false; }
  }
  update(state) { this.state = state; this.onChange(); }

  async releaseOne(lock) {
    try {
      if (!lock.released) await lock.release();
      if (!lock.released) return false;
      this.owned.delete(lock);
      return true;
    } catch { return false; }
  }

  async request() {
    const revision = ++this.revision;
    if (!this.allowed()) return false;
    if (!this.supported) { this.update('unsupported'); return false; }
    if (this.lock && !this.lock.released) { this.update('active'); return true; }
    this.update('requesting');
    try {
      const lock = await this.navigator.wakeLock.request('screen');
      this.owned.add(lock);
      if (revision !== this.revision || !this.allowed()) {
        const released = await this.releaseOne(lock);
        if (!released && !this.lock) this.update('release-failed');
        return false;
      }
      if (lock.released) { this.owned.delete(lock); this.update('released'); return false; }
      this.lock = lock;
      lock.addEventListener('release', () => {
        this.owned.delete(lock);
        if (this.lock === lock) { this.lock = null; this.update('released'); }
      }, { once: true });
      this.update('active');
      return true;
    } catch {
      if (revision === this.revision) this.update('unavailable');
      return false;
    }
  }

  async release() {
    const revision = ++this.revision;
    this.lock = null;
    const locks = [...this.owned];
    this.update(locks.length ? 'releasing' : 'idle');
    const results = await Promise.all(locks.map((lock) => this.releaseOne(lock)));
    if (revision === this.revision) this.update(results.some((released) => !released) ? 'release-failed' : 'idle');
    return results.every(Boolean);
  }
}
