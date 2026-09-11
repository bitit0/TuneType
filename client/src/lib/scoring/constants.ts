import type { PaceBand } from '@shared/types';

/**
 * Every tolerance value in the game, in one place, each with the reasoning behind it.
 *
 * These are starting guesses. The point of building the playable slice first is to retune them
 * against real gameplay — expect to come back here after actually playing a few songs.
 */

/** Standard typing-test convention: a "word" is five characters, spaces included. */
export const CHARS_PER_WORD = 5;

export const POINTS_PER_CORRECT_CHAR = 10;

/**
 * The floor a late line decays to.
 *
 * Not zero, and not close to it: LRCLIB entries are LINE-synced, not word-synced, so a line's
 * timestamp marks when singing starts and nothing marks when it ends. A player who types a long
 * line accurately but runs past the next cue has done the hard part. Halving is a real penalty
 * without making long lines feel unwinnable.
 */
export const TIMING_FLOOR_MULTIPLIER = 0.5;

/**
 * How far past its window a line decays over, as a multiple of the window's own length.
 *
 * Scaling to the window rather than using a fixed grace period is deliberate: a 2-second line and
 * an 8-second line demand different amounts of typing, so they deserve proportional slack.
 */
export const LATE_DECAY_WINDOWS = 1;

/**
 * Finishing early is never penalized.
 *
 * With line-synced lyrics, "early" usually just means the LRC timestamp ran late rather than the
 * player jumping the gun — and a line cannot be typed before it appears on screen anyway.
 */
export const PENALIZE_EARLY = false;

/**
 * How far ahead of the active line to show upcoming lines, and how far behind to keep past ones.
 * Purely presentational, but it affects difficulty: seeing the next line early lets players
 * prepare.
 */
export const LINES_AHEAD = 2;
export const LINES_BEHIND = 1;

// --- Required pace ----------------------------------------------------------------------------
//
// Inputs to the "needed WPM" a song demands, which is the number difficulty tiers will be built
// on. See `difficulty.ts` for what they mean.

/**
 * Shortest line that counts toward the peak.
 *
 * "Oh", "Hey", a repeated ad-lib — LRC files are full of two-character lines carrying a fraction
 * of a second, which compute to hundreds of WPM and describe nothing about the song.
 */
export const MIN_PEAK_LINE_CHARS = 8;

/**
 * Which per-line pace counts as "the hard part": the 95th percentile, not the maximum.
 *
 * One mistyped timestamp in an otherwise ordinary file would own the maximum outright. A high
 * percentile finds the hardest stretch a player actually has to sustain.
 */
export const PEAK_PERCENTILE = 0.95;

/**
 * Difficulty bands by required WPM, each an upper bound.
 *
 * Sung lyrics are more demanding to type than they look. A typical pop song runs 300-450 words
 * over three and a half minutes, and typing along with it in real time lands around 60-100 WPM —
 * comfortably above casual typing speed. Anything over 120 is essentially rap.
 *
 * First guesses, like every other constant in this file. They want retuning against a spread of
 * real songs before difficulty tiers lean on them.
 */
export const DIFFICULTY_BANDS = [
  { band: 'easy', upTo: 45 },
  { band: 'medium', upTo: 70 },
  { band: 'hard', upTo: 100 },
  { band: 'insane', upTo: Infinity },
] as const satisfies ReadonlyArray<{ band: PaceBand; upTo: number }>;

/** Arrow-key nudge step for manual offset correction during playback. */
export const OFFSET_NUDGE_STEP_MS = 100;

/** Clamp on the manual offset. Wider than any plausible title card, narrow enough to catch typos. */
export const OFFSET_LIMIT_MS = 30_000;
