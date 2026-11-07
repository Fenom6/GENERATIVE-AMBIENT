import { KouhaiView } from '../vendor/halo/kouhai.js';

/** 原作の描画を保ち、軌跡の寿命だけをコマ数から実際の秒数へ変える。 */
export class TimedKouhaiView extends KouhaiView {
  constructor(canvas) {
    super(canvas);
    this.trailTimes = this.orbs.map(() => []);
    this.trailSeconds = 2;
    this.trailTime = 0;
    // 点数の上限の代わりに、下の時間窓で毎コマ古い点を取り除く。
    this.trailLen = Infinity;
  }

  setTrailSeconds(seconds) { this.trailSeconds = seconds; }
  setTime(seconds) { this.trailTime = seconds; }

  clear() {
    super.clear();
    this.trailTimes = this.orbs.map(() => []);
  }

  drawOrbs(voices, dt) {
    const cutoff = this.trailTime - this.trailSeconds;
    const lengths = this.orbs.map((orb, index) => {
      if (!orb.trail.length) this.trailTimes[index] = [];
      const times = this.trailTimes[index];
      let expired = 0;
      while (expired < times.length && times[expired] <= cutoff + 1e-9) expired++;
      if (expired) { times.splice(0, expired); orb.trail.splice(0, expired * 2); }
      return orb.trail.length;
    });
    super.drawOrbs(voices, dt);
    this.orbs.forEach((orb, index) => {
      if (!orb.trail.length) this.trailTimes[index] = [];
      else if (orb.trail.length > lengths[index]) this.trailTimes[index].push(this.trailTime);
    });
  }
}
