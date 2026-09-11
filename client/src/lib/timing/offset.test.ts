import { describe, expect, it } from 'vitest';
import { lyricTimeFor, offsetFromTap } from './offset';

/**
 * These tests exist to pin a sign. There is no clever behaviour here — just the direction, which
 * was wrong once already and cost nothing to get wrong, because a flipped offset looks like a
 * video that needs correcting rather than like a bug.
 */

describe('the offset convention', () => {
  it('holds lyrics back for a video with a title card', () => {
    // Five seconds of title card: the line the LRC file puts at 10s is actually sung at 15s.
    const offsetMs = offsetFromTap(15_000, 10_000);
    expect(offsetMs).toBe(5_000);

    // And at that moment, the game must think it is exactly at the line's timestamp.
    expect(lyricTimeFor(15_000, offsetMs)).toBe(10_000);
  });

  it('pulls lyrics forward for a video that starts early', () => {
    // Rarer, but real: an upload trimmed into the first beat.
    const offsetMs = offsetFromTap(9_200, 10_000);
    expect(offsetMs).toBe(-800);
    expect(lyricTimeFor(9_200, offsetMs)).toBe(10_000);
  });

  it('round-trips any tap back onto the timestamp that was tapped against', () => {
    for (const [observed, timestamp] of [
      [0, 0],
      [1_234, 5_678],
      [90_000, 45_000],
    ]) {
      expect(lyricTimeFor(observed!, offsetFromTap(observed!, timestamp!))).toBe(timestamp);
    }
  });

  it('leaves a well-matched video alone', () => {
    expect(offsetFromTap(10_000, 10_000)).toBe(0);
    expect(lyricTimeFor(42_000, 0)).toBe(42_000);
  });
});
