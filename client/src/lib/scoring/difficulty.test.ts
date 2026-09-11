import { describe, expect, it } from 'vitest';
import type { LrcTimeMs, LyricLine } from '@shared/types';
import { analyzeDifficulty, bandFor } from './difficulty';

/**
 * Fixtures are synthetic — invented words with invented timings. Nothing in this repo is lyrics
 * content, and a test file is not an exception to that.
 */

function line(startMs: number, endMs: number, text: string): LyricLine {
  return { startMs: startMs as LrcTimeMs, endMs: endMs as LrcTimeMs, text };
}

describe('analyzeDifficulty', () => {
  it('measures the pace that lands every line inside its window', () => {
    // 50 characters = 10 words, over 10 seconds of windows = 1/6 minute → 60 WPM.
    const lines = [
      line(0, 5_000, 'a'.repeat(25)),
      line(5_000, 10_000, 'b'.repeat(25)),
    ];

    const { requiredWpm, charCount, singingMs } = analyzeDifficulty(lines);

    expect(charCount).toBe(50);
    expect(singingMs).toBe(10_000);
    expect(requiredWpm).toBeCloseTo(60, 5);
  });

  it('reports a peak above the average when one stretch is much denser', () => {
    // Three relaxed lines and one that packs the same text into a quarter of the time. The average
    // stays moderate; the peak is what says this song has a wall in it.
    const lines = [
      line(0, 8_000, 'c'.repeat(40)),
      line(8_000, 16_000, 'c'.repeat(40)),
      line(16_000, 24_000, 'c'.repeat(40)),
      line(24_000, 26_000, 'c'.repeat(40)),
    ];

    const { requiredWpm, peakWpm } = analyzeDifficulty(lines);

    expect(peakWpm).toBeGreaterThan(requiredWpm * 2);
  });

  it('ignores short ad-lib lines when finding the peak', () => {
    // "Oh" on a 300ms window is 80 WPM of nothing. Left in, it would define the song's difficulty.
    const withAdLib = analyzeDifficulty([
      line(0, 6_000, 'd'.repeat(30)),
      line(6_000, 6_300, 'Oh'),
      line(6_300, 12_000, 'd'.repeat(30)),
    ]);

    const withoutAdLib = analyzeDifficulty([
      line(0, 6_000, 'd'.repeat(30)),
      line(6_300, 12_000, 'd'.repeat(30)),
    ]);

    expect(withAdLib.peakWpm).toBeCloseTo(withoutAdLib.peakWpm, 5);
  });

  it('never reports a peak below the sustained pace', () => {
    // Every line too short to judge. Zero would read as "easy", which is the opposite of true.
    const { requiredWpm, peakWpm } = analyzeDifficulty([
      line(0, 400, 'Oh'),
      line(400, 800, 'Hey'),
    ]);

    expect(peakWpm).toBeGreaterThanOrEqual(requiredWpm);
    expect(peakWpm).toBeGreaterThan(0);
  });

  it('counts the gap after a line as time available for it', () => {
    // Lines tile with no gaps — a line's window runs until the next one is sung, so an instrumental
    // break is time you genuinely have. This is the scoring model's own definition, not a separate
    // one: finishing anywhere inside the window earns the full timing multiplier.
    const tight = analyzeDifficulty([line(0, 2_000, 'e'.repeat(20)), line(2_000, 4_000, 'e'.repeat(20))]);
    const withBreak = analyzeDifficulty([line(0, 30_000, 'e'.repeat(20)), line(30_000, 32_000, 'e'.repeat(20))]);

    expect(withBreak.requiredWpm).toBeLessThan(tight.requiredWpm);
  });

  it('returns zeroes for a track with no lines instead of dividing by zero', () => {
    expect(analyzeDifficulty([])).toMatchObject({ requiredWpm: 0, peakWpm: 0, lineCount: 0 });
  });
});

describe('bandFor', () => {
  it('grades across the range a real song can land in', () => {
    expect(bandFor(20)).toBe('easy');
    expect(bandFor(60)).toBe('medium');
    expect(bandFor(85)).toBe('hard');
    expect(bandFor(160)).toBe('insane');
  });

  it('never grades a song as Freestyle', () => {
    // Freestyle is a curator's shelf, not a measurement. No pace can imply it, which is why it
    // lives outside `PaceBand` in the type rather than as a fifth entry in the band table.
    for (const wpm of [0, 1, 44, 45, 70, 100, 500, 10_000]) {
      expect(bandFor(wpm)).not.toBe('freestyle');
    }
  });
});
