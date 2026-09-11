import { describe, expect, it } from 'vitest';
import type { LineSpec, VerifiedLineClaim } from '@shared/types';
import { InvalidRunError, scoreVerifiedRun } from './score.js';
import { scoreLine, summarizeRun } from '../../../client/src/lib/scoring/score.js';

/**
 * The important test here is the last one.
 *
 * This module duplicates four constants and one formula from the client's scoring code, because
 * `shared/` is type-only and cannot carry values. Duplication like that rots silently: someone
 * retunes `TIMING_FLOOR_MULTIPLIER` on the client, the results screen shows one number, the
 * leaderboard stores another, and nothing fails until a player notices their own run disagreeing
 * with itself.
 *
 * So the two implementations are run against the same fixtures and required to agree exactly.
 */

const line = (len: number, startMs: number, endMs: number): LineSpec => ({ len, startMs, endMs });

const claim = (
  i: number,
  correct: number,
  typed: number,
  doneAtMs: number | null,
  typingMs: number,
): VerifiedLineClaim => ({ i, correct, typed, doneAtMs, typingMs });

describe('scoreVerifiedRun', () => {
  const profile = [line(20, 0, 4_000), line(30, 4_000, 8_000)];

  it('prices a clean run', () => {
    const result = scoreVerifiedRun(profile, [
      claim(0, 20, 20, 3_000, 2_000),
      claim(1, 30, 30, 7_000, 3_000),
    ]);

    // Both lines finished inside their windows, so every character is worth full value.
    expect(result.totalScore).toBe(500);
    expect(result.accuracy).toBe(1);
    expect(result.linesCompleted).toBe(2);
  });

  it('refuses a line longer than the song has', () => {
    expect(() => scoreVerifiedRun(profile, [claim(0, 25, 25, 1_000, 900)])).toThrow(InvalidRunError);
  });

  it('refuses more correct characters than were typed', () => {
    expect(() => scoreVerifiedRun(profile, [claim(0, 15, 10, 1_000, 900)])).toThrow(InvalidRunError);
  });

  it('refuses a line index the song does not have', () => {
    expect(() => scoreVerifiedRun(profile, [claim(7, 1, 1, 1_000, 900)])).toThrow(InvalidRunError);
  });

  it('refuses the same line twice, which would score it twice', () => {
    expect(() =>
      scoreVerifiedRun(profile, [claim(0, 20, 20, 1_000, 900), claim(0, 20, 20, 1_000, 900)]),
    ).toThrow(InvalidRunError);
  });

  it('refuses an entry with no profile rather than scoring it as zero', () => {
    expect(() => scoreVerifiedRun([], [claim(0, 1, 1, 1, 1)])).toThrow(InvalidRunError);
  });

  it('agrees with the client implementation, line for line', () => {
    /*
     * Cases chosen to cross every branch of the timing multiplier: inside the window, finished
     * early, finished late but within the decay, past the decay entirely, and never finished.
     */
    const cases: Array<{ spec: LineSpec; correct: number; typed: number; doneAtMs: number | null; typingMs: number }> = [
      { spec: line(20, 0, 4_000), correct: 20, typed: 20, doneAtMs: 2_000, typingMs: 1_800 },
      // Typed right up to the cap. The client stops accepting input at the end of a line, so this
      // is the most a claim can honestly report.
      { spec: line(20, 4_000, 8_000), correct: 18, typed: 20, doneAtMs: 3_500, typingMs: 1_200 },
      { spec: line(30, 8_000, 12_000), correct: 25, typed: 30, doneAtMs: 14_000, typingMs: 2_600 },
      { spec: line(30, 12_000, 16_000), correct: 30, typed: 30, doneAtMs: 25_000, typingMs: 3_100 },
      { spec: line(15, 16_000, 20_000), correct: 9, typed: 12, doneAtMs: null, typingMs: 1_400 },
    ];

    const profileUnderTest = cases.map((c) => c.spec);

    const mine = scoreVerifiedRun(
      profileUnderTest,
      cases.map((c, i) => claim(i, c.correct, c.typed, c.doneAtMs, c.typingMs)),
    );

    /*
     * The client scores strings, not counts. `target` is one repeated character and `typed` starts
     * with the correct prefix and then diverges, which makes its positional comparison produce
     * exactly the counts above.
     *
     * Typing time needs more care. The client measures a completed line from its first keystroke to
     * its completion, not to its last keystroke, so the first keystroke has to be placed `typingMs`
     * BEFORE the completion to produce the intended interval. A line that was never completed falls
     * back to the last keystroke instead.
     */
    const theirs = summarizeRun(
      cases.map((c, i) =>
        scoreLine({
          lineIndex: i,
          target: 'a'.repeat(c.spec.len),
          typed: 'a'.repeat(c.correct) + 'b'.repeat(c.typed - c.correct),
          completedAtMs: c.doneAtMs,
          firstKeystrokeAtMs: c.doneAtMs === null ? 0 : c.doneAtMs - c.typingMs,
          lastKeystrokeAtMs: c.doneAtMs ?? c.typingMs,
          windowStartMs: c.spec.startMs,
          windowEndMs: c.spec.endMs,
        }),
      ),
      0,
    );

    // RunSummary reports accuracy and speed but not the raw counts behind them; the client sums
    // those from the line results, in `toRunSubmission`. Same arithmetic, done the same way here.
    const theirCorrect = theirs.lines.reduce((n, l) => n + l.correctChars, 0);
    const theirTyped = theirs.lines.reduce((n, l) => n + l.typedChars, 0);

    expect(mine.totalScore).toBe(theirs.totalScore);
    expect(mine.correctChars).toBe(theirCorrect);
    expect(mine.typedChars).toBe(theirTyped);
    expect(mine.accuracy).toBeCloseTo(theirs.accuracy, 10);
    expect(mine.wpm).toBeCloseTo(theirs.wpm, 10);
    expect(mine.linesCompleted).toBe(theirs.linesCompleted);
  });
});
