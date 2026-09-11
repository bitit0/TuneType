/**
 * A smooth, drift-corrected playback clock built on a deliberately coarse source.
 *
 * The problem: the YouTube IFrame player is cross-origin, so we cannot touch the audio. The only
 * time source is `getCurrentTime()`, which advances in steps of roughly 250ms. Driving lyric
 * highlighting off it directly produces visible stutter, and any judgement about typing feel made
 * through that stutter would be measuring the wrong thing.
 *
 * The approach has two ideas worth stating plainly, because neither is obvious:
 *
 * 1. ANCHOR ON STEP EDGES, NOT ON EVERY POLL. Any single reading of `getCurrentTime()` lags true
 *    playback by an unknown 0-250ms, so treating each poll as ground truth just imports the
 *    source's coarseness. But the *instant the value changes* is a precise event: at that moment
 *    true playback time is pinned to within one poll interval. So we re-anchor only on
 *    transitions and ignore repeated readings entirely.
 *
 * 2. SLEW, DON'T SNAP. When a fresh anchor disagrees with where we projected we'd be, jumping to
 *    the new value would be visible as a hitch in the lyrics. Instead we bend the clock's *rate*
 *    slightly and let it converge over about a second. Only a disagreement too large to be drift
 *    — a seek — is worth a hard jump.
 */

/** The slice of the YouTube player API this clock needs. Kept minimal so tests can fake it. */
export interface PlayerLike {
  /** Current position, in SECONDS, as the IFrame API reports it. */
  getCurrentTime(): number;
  getPlayerState(): number;
}

/** YouTube IFrame player states. */
export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface VirtualClockOptions {
  /** How often to read the player. Below the ~250ms source granularity so no step edge is missed. */
  pollIntervalMs?: number;
  /**
   * Disagreement above which we stop treating it as drift and treat it as a seek. Just above the
   * source's own granularity: anything larger cannot be explained by polling lag.
   */
  hardSnapThresholdMs?: number;
  /** How long a slew correction takes to converge. Long enough to stay invisible. */
  slewWindowMs?: number;
  /**
   * Ceiling on rate distortion while slewing. 2% is far below the ~4% threshold where pitch or
   * scroll speed changes become perceptible, so corrections stay invisible.
   */
  maxRateDeviation?: number;
  /** Injectable for tests. Defaults to `performance.now`. */
  wallClock?: () => number;
}

export interface ClockDebugInfo {
  virtualMs: number;
  polledMs: number;
  driftMs: number;
  rate: number;
  running: boolean;
  anchorCount: number;
  snapCount: number;
}

const DEFAULTS = {
  pollIntervalMs: 100,
  hardSnapThresholdMs: 250,
  slewWindowMs: 1000,
  maxRateDeviation: 0.02,
};

export class VirtualClock {
  private readonly player: PlayerLike;
  private readonly opts: Required<Omit<VirtualClockOptions, 'wallClock'>>;
  private readonly wallClock: () => number;

  /** Video position at the last anchor, in ms. */
  private anchorVideoMs = 0;
  /** Wall time at the last anchor, in ms. */
  private anchorWallMs = 0;
  /** Multiplier on wall time. Nudged away from 1 to absorb drift, then settles back. */
  private rate = 1;

  /** Last value seen from the player, used to detect step edges. */
  private lastPolledMs: number | null = null;
  /** While false, `now()` is frozen — the video is paused, buffering or not started. */
  private running = false;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDriftMs = 0;
  private anchorCount = 0;
  private snapCount = 0;

  constructor(player: PlayerLike, options: VirtualClockOptions = {}) {
    this.player = player;
    this.opts = { ...DEFAULTS, ...options };
    this.wallClock = options.wallClock ?? (() => performance.now());
  }

  start(): void {
    if (this.timer !== null) return;
    this.resetTo(this.readPlayerMs());
    this.syncRunningState();
    this.timer = setInterval(() => this.poll(), this.opts.pollIntervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Current playback position in milliseconds. Safe to call every animation frame. */
  now(): number {
    if (!this.running) return this.anchorVideoMs;
    return this.projectAt(this.wallClock());
  }

  /**
   * Called by the player component on `onStateChange`, so transitions are handled the moment they
   * happen instead of up to one poll interval later. Play/pause boundaries are exactly where a
   * stale clock is most visible.
   */
  onStateChange(state: number): void {
    if (state === PlayerState.PLAYING) {
      // Re-anchor rather than resume: time may have moved while we were frozen (a seek while
      // paused), and the first reading after resuming is fresh.
      this.resetTo(this.readPlayerMs());
      this.running = true;
      return;
    }

    if (
      state === PlayerState.PAUSED ||
      state === PlayerState.BUFFERING ||
      state === PlayerState.ENDED ||
      state === PlayerState.UNSTARTED ||
      state === PlayerState.CUED
    ) {
      // Freeze at where we currently believe we are. Recording the position now is what stops
      // paused wall time from being counted as playback on resume.
      this.anchorVideoMs = this.now();
      this.anchorWallMs = this.wallClock();
      this.running = false;
    }
  }

  getDebugInfo(): ClockDebugInfo {
    return {
      virtualMs: this.now(),
      polledMs: this.lastPolledMs ?? 0,
      driftMs: this.lastDriftMs,
      rate: this.rate,
      running: this.running,
      anchorCount: this.anchorCount,
      snapCount: this.snapCount,
    };
  }

  // --- internals ---------------------------------------------------------------------------

  private readPlayerMs(): number {
    const seconds = this.player.getCurrentTime();
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }

  private projectAt(wallMs: number): number {
    return this.anchorVideoMs + (wallMs - this.anchorWallMs) * this.rate;
  }

  private resetTo(videoMs: number): void {
    this.anchorVideoMs = videoMs;
    this.anchorWallMs = this.wallClock();
    this.rate = 1;
    this.lastPolledMs = videoMs;
    this.lastDriftMs = 0;
    this.anchorCount += 1;
  }

  private syncRunningState(): void {
    this.running = this.player.getPlayerState() === PlayerState.PLAYING;
  }

  private poll(): void {
    const polledMs = this.readPlayerMs();
    const state = this.player.getPlayerState();
    const wasRunning = this.running;
    this.running = state === PlayerState.PLAYING;

    // Transitioned into playback without an onStateChange reaching us.
    if (this.running && !wasRunning) {
      this.resetTo(polledMs);
      return;
    }

    if (!this.running) {
      // Still poll while paused so a seek is noticed immediately rather than on resume.
      if (this.lastPolledMs !== null && Math.abs(polledMs - this.lastPolledMs) > this.opts.hardSnapThresholdMs) {
        this.anchorVideoMs = polledMs;
        this.anchorWallMs = this.wallClock();
        this.snapCount += 1;
      }
      this.lastPolledMs = polledMs;
      return;
    }

    // The heart of it: a repeated reading carries no new information, because the source only
    // updates every ~250ms. Acting on it would fold that staleness into our clock.
    if (polledMs === this.lastPolledMs) return;

    this.lastPolledMs = polledMs;

    const wallMs = this.wallClock();
    const projectedMs = this.projectAt(wallMs);
    const driftMs = polledMs - projectedMs;
    this.lastDriftMs = driftMs;
    this.anchorCount += 1;

    if (Math.abs(driftMs) > this.opts.hardSnapThresholdMs) {
      // Too large to be polling lag — a seek, a stall, or a tab that was backgrounded.
      this.anchorVideoMs = polledMs;
      this.anchorWallMs = wallMs;
      this.rate = 1;
      this.snapCount += 1;
      return;
    }

    // Re-anchor at where we *currently claim to be*, not at the polled value, so the clock stays
    // continuous — the correction goes into the rate instead of into a jump.
    this.anchorVideoMs = projectedMs;
    this.anchorWallMs = wallMs;

    const correction = driftMs / this.opts.slewWindowMs;
    const { maxRateDeviation } = this.opts;
    this.rate = Math.min(1 + maxRateDeviation, Math.max(1 - maxRateDeviation, 1 + correction));
  }
}
