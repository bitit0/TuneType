import type { LyricLine, PaceBand } from '@shared/types';
import { CHARS_PER_WORD, MIN_PEAK_LINE_CHARS, PEAK_PERCENTILE, DIFFICULTY_BANDS } from './constants';

/**
 * How fast you would have to type to keep up with a song.
 *
 * Derived entirely from the LRC timings, so it is known before a note plays and costs nothing to
 * compute. That is what makes it usable as the input to difficulty tiers — a song can be graded
 * without anyone having played it.
 *
 * The definition is pinned to the scoring model rather than invented separately: a line's window
 * runs from its own timestamp to the next line's, and finishing anywhere inside that window earns
 * the full timing multiplier. So "required WPM" is exactly the pace at which every line lands on
 * time — not a pace at which you merely survive.
 *
 * It is an *estimate* in one specific way, worth being honest about: it assumes you start typing
 * the instant a line's window opens. Nobody does. Real pace has to be a little higher, and how
 * much higher depends on reading speed and how far ahead the display shows the next line.
 */

/**
 * The measured band. An alias for `PaceBand` rather than a type derived from the table, so that a
 * measurement can never widen into `SetlistTier` and produce Freestyle — which no measurement can
 * mean, since Freestyle is defined by having no pace range at all.
 */
export type DifficultyBand = PaceBand;

export interface TrackDifficulty {
  /** Sustained pace needed to finish every line inside its window, in WPM. The headline number. */
  requiredWpm: number;
  /**
   * The pace the hardest stretch demands.
   *
   * A song's average can be gentle while one rapid-fire verse is brutal, and the average alone
   * would grade those as the same song. This is the number that separates them.
   */
  peakWpm: number;
  band: DifficultyBand;
  charCount: number;
  lineCount: number;
  /** Summed line windows — the span from the first line to the end of the last. */
  singingMs: number;
}

const EMPTY: TrackDifficulty = {
  requiredWpm: 0,
  peakWpm: 0,
  band: 'easy',
  charCount: 0,
  lineCount: 0,
  singingMs: 0,
};

/** WPM needed to type `chars` within `ms`. Zero when there is no time to measure over. */
function paceFor(chars: number, ms: number): number {
  if (ms <= 0) return 0;
  return chars / CHARS_PER_WORD / (ms / 60_000);
}

export function bandFor(requiredWpm: number): DifficultyBand {
  for (const { band, upTo } of DIFFICULTY_BANDS) {
    if (requiredWpm < upTo) return band;
  }
  return DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1]!.band;
}

/**
 * The peak, as a high percentile of per-line demand rather than the outright maximum.
 *
 * Two guards, both learned from what LRC files actually contain. Very short lines — "Oh", "Yeah",
 * a repeated ad-lib — routinely carry a fraction of a second and produce absurd per-line paces
 * that say nothing about the song, so they are excluded by length. And a single mistimed timestamp
 * in an otherwise ordinary file would own the maximum outright, so the percentile takes the
 * hardest *sustained* line instead of the single worst one.
 */
function peakOf(perLineWpm: number[]): number {
  if (perLineWpm.length === 0) return 0;

  const sorted = [...perLineWpm].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * PEAK_PERCENTILE));
  return sorted[index]!;
}

export function analyzeDifficulty(lines: LyricLine[]): TrackDifficulty {
  if (lines.length === 0) return EMPTY;

  let charCount = 0;
  let singingMs = 0;
  const perLineWpm: number[] = [];

  for (const line of lines) {
    const windowMs = Math.max(0, line.endMs - line.startMs);
    charCount += line.text.length;
    singingMs += windowMs;

    if (line.text.length >= MIN_PEAK_LINE_CHARS) {
      perLineWpm.push(paceFor(line.text.length, windowMs));
    }
  }

  const requiredWpm = paceFor(charCount, singingMs);

  return {
    requiredWpm,
    // Falls back to the sustained pace when every line was too short to judge — a song made
    // entirely of one-word lines has no meaningful peak, and reporting zero would read as "easy".
    peakWpm: Math.max(requiredWpm, peakOf(perLineWpm)),
    band: bandFor(requiredWpm),
    charCount,
    lineCount: lines.length,
    singingMs,
  };
}
