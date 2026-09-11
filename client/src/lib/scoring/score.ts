import type { LineResult, RunSummary } from '@shared/types';
import {
  CHARS_PER_WORD,
  LATE_DECAY_WINDOWS,
  PENALIZE_EARLY,
  POINTS_PER_CORRECT_CHAR,
  TIMING_FLOOR_MULTIPLIER,
} from './constants';

export interface LineAttempt {
  lineIndex: number;
  /** The line as it should be typed. */
  target: string;
  /** What the player actually typed for it. */
  typed: string;
  /** Offset-adjusted time the line was finished, or null if they never got to the end. */
  completedAtMs: number | null;
  /** Offset-adjusted time of the first key pressed against this line. */
  firstKeystrokeAtMs: number | null;
  /** Offset-adjusted time of the last key pressed against this line. */
  lastKeystrokeAtMs: number | null;
  windowStartMs: number;
  windowEndMs: number;
}

/**
 * How long the player was actually typing this line.
 *
 * The clock starts on the line's first keystroke and stops the moment the line is finished — it
 * does not keep running afterwards. That distinction is the whole point: a song is mostly not
 * typing. Instrumental breaks, the gap between one line ending and the next being sung, and the
 * outro after the final line are all dead time, and charging them to the player's speed would say
 * more about the song's arrangement than about how fast they type.
 *
 * Starting on the first keystroke rather than when the line appears is the same argument applied to
 * the other end: line-synced lyrics routinely open a line's window seconds before the vocal starts,
 * so that lead-in is the LRC file's slack, not the player's hesitation.
 *
 * A line abandoned part-way still counts the time spent on it — its characters count toward the
 * score, so their cost has to count too, or giving up on long lines would inflate WPM.
 */
export function lineTypingMs(attempt: LineAttempt): number {
  const { firstKeystrokeAtMs, lastKeystrokeAtMs, completedAtMs } = attempt;
  if (firstKeystrokeAtMs === null) return 0;

  const stoppedAtMs = completedAtMs ?? lastKeystrokeAtMs;
  if (stoppedAtMs === null) return 0;

  // A nudge mid-line shifts offset-adjusted stamps under us, so clamp rather than trust the sign.
  return Math.max(0, stoppedAtMs - firstKeystrokeAtMs);
}

/** Correct characters by position. Deliberately not a fuzzy diff: a missed character shifts
 *  everything after it, and that cascade is what a typing game is supposed to punish. */
export function countCorrectChars(target: string, typed: string): number {
  const shared = Math.min(target.length, typed.length);
  let correct = 0;
  for (let i = 0; i < shared; i++) {
    if (target[i] === typed[i]) correct++;
  }
  return correct;
}

/**
 * How much of the line's value the player keeps, based on when they finished it.
 *
 * Full credit anywhere inside the window, then a linear decay to a floor over one further window
 * length. Early is free — see PENALIZE_EARLY.
 */
export function timingMultiplier(
  completedAtMs: number | null,
  windowStartMs: number,
  windowEndMs: number,
): number {
  // Never finished: they typed what they typed, but earn no timing credit beyond the floor.
  if (completedAtMs === null) return TIMING_FLOOR_MULTIPLIER;

  if (completedAtMs < windowStartMs) {
    return PENALIZE_EARLY ? TIMING_FLOOR_MULTIPLIER : 1;
  }

  if (completedAtMs <= windowEndMs) return 1;

  const windowLengthMs = Math.max(1, windowEndMs - windowStartMs);
  const graceMs = windowLengthMs * LATE_DECAY_WINDOWS;
  const lateBy = completedAtMs - windowEndMs;

  if (lateBy >= graceMs) return TIMING_FLOOR_MULTIPLIER;

  const decayed = 1 - (lateBy / graceMs) * (1 - TIMING_FLOOR_MULTIPLIER);
  return decayed;
}

export function scoreLine(attempt: LineAttempt): LineResult {
  const correctChars = countCorrectChars(attempt.target, attempt.typed);
  const multiplier = timingMultiplier(
    attempt.completedAtMs,
    attempt.windowStartMs,
    attempt.windowEndMs,
  );

  return {
    lineIndex: attempt.lineIndex,
    targetLength: attempt.target.length,
    correctChars,
    typedChars: attempt.typed.length,
    completedAtMs: attempt.completedAtMs,
    typingMs: lineTypingMs(attempt),
    timingMultiplier: multiplier,
    score: Math.round(correctChars * POINTS_PER_CORRECT_CHAR * multiplier),
  };
}

/**
 * Rolls line results into the numbers shown on the results screen.
 *
 * WPM is measured against time spent typing lines, summed per line, rather than against the span
 * of the run — see `lineTypingMs`. `elapsedMs` is still reported, because how long a run took is
 * worth showing, but it is not what speed is divided by.
 */
export function summarizeRun(lines: LineResult[], elapsedMs: number): RunSummary {
  let totalScore = 0;
  let correctChars = 0;
  let typedChars = 0;
  let linesCompleted = 0;
  let typingMs = 0;

  for (const line of lines) {
    totalScore += line.score;
    correctChars += line.correctChars;
    typedChars += line.typedChars;
    typingMs += line.typingMs;
    if (line.completedAtMs !== null) linesCompleted++;
  }

  const minutes = typingMs / 60_000;

  return {
    totalScore,
    accuracy: typedChars === 0 ? 0 : correctChars / typedChars,
    // Net WPM: only correct characters count, so accuracy is already priced in.
    //
    // A zero denominator is reachable honestly — every line finished on a single keystroke leaves
    // no measurable interval — and reporting 0 is the right answer there. Speed over an
    // unmeasurably short sample is not a number worth inventing.
    wpm: minutes <= 0 ? 0 : correctChars / CHARS_PER_WORD / minutes,
    typingMs,
    elapsedMs,
    linesAttempted: lines.length,
    linesCompleted,
    lines,
  };
}
