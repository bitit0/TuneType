import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VirtualClock, PlayerState, type PlayerLike } from './VirtualClock';

/**
 * The whole point of this class is turning a coarse, stepped time source into a smooth one, so the
 * fake player below deliberately reproduces that coarseness: it only reports multiples of 250ms,
 * exactly like the real IFrame API.
 */
const SOURCE_STEP_MS = 250;
const POLL_MS = 100;

class Harness {
  wallMs = 0;
  /** Where playback truly is. The player only ever exposes a floored version of this. */
  trueVideoMs = 0;
  state: number = PlayerState.PLAYING;
  clock: VirtualClock;

  private readonly player: PlayerLike = {
    getCurrentTime: () => Math.floor(this.trueVideoMs / SOURCE_STEP_MS) * SOURCE_STEP_MS / 1000,
    getPlayerState: () => this.state,
  };

  constructor() {
    this.clock = new VirtualClock(this.player, { wallClock: () => this.wallMs });
  }

  /** Advances wall time (and playback, when playing) in one-poll slices. */
  advance(ms: number): void {
    const slices = Math.round(ms / POLL_MS);
    for (let i = 0; i < slices; i++) {
      this.wallMs += POLL_MS;
      if (this.state === PlayerState.PLAYING) this.trueVideoMs += POLL_MS;
      vi.advanceTimersByTime(POLL_MS);
    }
  }
}

describe('VirtualClock', () => {
  let h: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    h = new Harness();
  });

  afterEach(() => {
    h.clock.stop();
    vi.useRealTimers();
  });

  it('produces a continuously moving clock from a stepped source', () => {
    h.clock.start();
    h.advance(2000);

    // Sample between polls. A naive implementation reading getCurrentTime() directly would return
    // the same value across all of these; this one must not.
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.wallMs += 16;
      samples.push(h.clock.now());
    }

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
    }
  });

  it('tracks true playback closely despite the source lagging up to a full step', () => {
    h.clock.start();
    h.advance(5000);

    expect(Math.abs(h.clock.now() - h.trueVideoMs)).toBeLessThan(150);
  });

  it('re-anchors only when the source value changes, not on every poll', () => {
    h.clock.start();
    const before = h.clock.getDebugInfo().anchorCount;

    h.advance(1000); // 10 polls, but only ~4 step edges

    const anchors = h.clock.getDebugInfo().anchorCount - before;
    expect(anchors).toBeGreaterThan(0);
    expect(anchors).toBeLessThanOrEqual(5);
  });

  it('absorbs ordinary drift by bending the rate rather than jumping', () => {
    h.clock.start();
    h.advance(2000);

    const snapsBefore = h.clock.getDebugInfo().snapCount;

    // Nudge playback by less than the hard-snap threshold, as a small stall would.
    h.trueVideoMs += 120;
    h.advance(1000);

    const debug = h.clock.getDebugInfo();
    expect(debug.snapCount).toBe(snapsBefore);
    expect(debug.rate).toBeGreaterThan(0.97);
    expect(debug.rate).toBeLessThan(1.03);
  });

  it('converges back onto the source after a small disturbance', () => {
    h.clock.start();
    h.advance(2000);

    h.trueVideoMs += 120;
    h.advance(3000);

    expect(Math.abs(h.clock.now() - h.trueVideoMs)).toBeLessThan(150);
  });

  it('hard-snaps on a seek instead of slewing for minutes', () => {
    h.clock.start();
    h.advance(2000);

    const snapsBefore = h.clock.getDebugInfo().snapCount;

    h.trueVideoMs = 90_000; // user dragged the scrubber
    h.advance(300);

    expect(h.clock.getDebugInfo().snapCount).toBeGreaterThan(snapsBefore);
    expect(Math.abs(h.clock.now() - h.trueVideoMs)).toBeLessThan(400);
  });

  it('freezes while paused', () => {
    h.clock.start();
    h.advance(2000);

    h.state = PlayerState.PAUSED;
    h.clock.onStateChange(PlayerState.PAUSED);
    const frozen = h.clock.now();

    h.advance(5000); // wall time passes; playback does not
    h.wallMs += 1234;

    expect(h.clock.now()).toBe(frozen);
  });

  it('does not count paused wall time as playback after resuming', () => {
    h.clock.start();
    h.advance(2000);

    h.state = PlayerState.PAUSED;
    h.clock.onStateChange(PlayerState.PAUSED);
    const atPause = h.clock.now();

    h.advance(10_000); // a long pause

    h.state = PlayerState.PLAYING;
    h.clock.onStateChange(PlayerState.PLAYING);
    h.advance(1000);

    // Roughly one second of playback should have elapsed, not eleven.
    expect(h.clock.now() - atPause).toBeGreaterThan(700);
    expect(h.clock.now() - atPause).toBeLessThan(1300);
  });

  it('picks up a seek performed while paused', () => {
    h.clock.start();
    h.advance(2000);

    h.state = PlayerState.PAUSED;
    h.clock.onStateChange(PlayerState.PAUSED);

    h.trueVideoMs = 60_000;
    h.advance(300);

    expect(Math.abs(h.clock.now() - 60_000)).toBeLessThan(400);
  });

  it('freezes during buffering and recovers afterwards', () => {
    h.clock.start();
    h.advance(2000);

    h.state = PlayerState.BUFFERING;
    h.clock.onStateChange(PlayerState.BUFFERING);
    const frozen = h.clock.now();
    h.advance(2000);
    expect(h.clock.now()).toBe(frozen);

    h.state = PlayerState.PLAYING;
    h.clock.onStateChange(PlayerState.PLAYING);
    h.advance(1000);

    expect(Math.abs(h.clock.now() - h.trueVideoMs)).toBeLessThan(200);
  });

  it('stops polling once stopped', () => {
    h.clock.start();
    h.advance(1000);
    h.clock.stop();

    const anchors = h.clock.getDebugInfo().anchorCount;
    h.advance(2000);

    expect(h.clock.getDebugInfo().anchorCount).toBe(anchors);
  });
});
