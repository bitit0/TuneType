import { describe, it, expect } from 'vitest';
import {
  countCorrectChars,
  lineTypingMs,
  timingMultiplier,
  scoreLine,
  summarizeRun,
} from './score';
import { TIMING_FLOOR_MULTIPLIER, POINTS_PER_CORRECT_CHAR } from './constants';

const WINDOW_START = 10_000;
const WINDOW_END = 14_000;
const WINDOW_LENGTH = WINDOW_END - WINDOW_START;

describe('countCorrectChars', () => {
  it('counts exact matches by position', () => {
    expect(countCorrectChars('abcdef', 'abcdef')).toBe(6);
    expect(countCorrectChars('abcdef', 'abXdef')).toBe(5);
  });

  it('counts only what was typed when the line is unfinished', () => {
    expect(countCorrectChars('abcdef', 'abc')).toBe(3);
  });

  it('ignores characters typed past the end of the line', () => {
    expect(countCorrectChars('abc', 'abcdef')).toBe(3);
  });

  it('punishes a dropped character as a cascade, not a single miss', () => {
    // "bcdef" against "abcdef" lines up nowhere after position 0 — that is intended.
    expect(countCorrectChars('abcdef', 'bcdef')).toBe(0);
  });

  it('handles empty input', () => {
    expect(countCorrectChars('abc', '')).toBe(0);
    expect(countCorrectChars('', 'abc')).toBe(0);
  });
});

describe('timingMultiplier', () => {
  it('gives full credit anywhere inside the window', () => {
    expect(timingMultiplier(WINDOW_START, WINDOW_START, WINDOW_END)).toBe(1);
    expect(timingMultiplier(12_000, WINDOW_START, WINDOW_END)).toBe(1);
    expect(timingMultiplier(WINDOW_END, WINDOW_START, WINDOW_END)).toBe(1);
  });

  it('does not penalize finishing early', () => {
    expect(timingMultiplier(WINDOW_START - 500, WINDOW_START, WINDOW_END)).toBe(1);
  });

  it('decays linearly once past the window', () => {
    const halfway = WINDOW_END + WINDOW_LENGTH / 2;
    const expected = 1 - 0.5 * (1 - TIMING_FLOOR_MULTIPLIER);

    expect(timingMultiplier(halfway, WINDOW_START, WINDOW_END)).toBeCloseTo(expected, 5);
  });

  it('bottoms out at the floor rather than going to zero', () => {
    expect(timingMultiplier(WINDOW_END + WINDOW_LENGTH, WINDOW_START, WINDOW_END)).toBe(
      TIMING_FLOOR_MULTIPLIER,
    );
    expect(timingMultiplier(WINDOW_END + 999_999, WINDOW_START, WINDOW_END)).toBe(
      TIMING_FLOOR_MULTIPLIER,
    );
  });

  it('scales its grace period to the window length', () => {
    // A long line gets proportionally more slack than a short one at the same lateness.
    const shortLine = timingMultiplier(3_000, 1_000, 2_000);
    const longLine = timingMultiplier(11_000, 1_000, 10_000);

    expect(shortLine).toBe(TIMING_FLOOR_MULTIPLIER);
    expect(longLine).toBeGreaterThan(shortLine);
  });

  it('gives an unfinished line the floor', () => {
    expect(timingMultiplier(null, WINDOW_START, WINDOW_END)).toBe(TIMING_FLOOR_MULTIPLIER);
  });

  it('does not divide by zero on a degenerate window', () => {
    expect(Number.isFinite(timingMultiplier(5_001, 5_000, 5_000))).toBe(true);
  });
});

describe('scoreLine', () => {
  it('multiplies correct characters by the timing multiplier', () => {
    const result = scoreLine({
      lineIndex: 0,
      target: 'alpha bravo',
      typed: 'alpha bravo',
      completedAtMs: 12_000,
      firstKeystrokeAtMs: 10_000,
      lastKeystrokeAtMs: 12_000,
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
    });

    expect(result.correctChars).toBe(11);
    expect(result.timingMultiplier).toBe(1);
    expect(result.score).toBe(11 * POINTS_PER_CORRECT_CHAR);
  });

  it('still awards points for an unfinished line, at the floor', () => {
    const result = scoreLine({
      lineIndex: 1,
      target: 'alpha bravo',
      typed: 'alpha',
      completedAtMs: null,
      firstKeystrokeAtMs: 10_000,
      lastKeystrokeAtMs: 11_000,
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
    });

    expect(result.correctChars).toBe(5);
    expect(result.score).toBe(Math.round(5 * POINTS_PER_CORRECT_CHAR * TIMING_FLOOR_MULTIPLIER));
  });

  it('awards nothing for a line typed entirely wrong', () => {
    const result = scoreLine({
      lineIndex: 2,
      target: 'alpha',
      typed: 'zzzzz',
      completedAtMs: 12_000,
      firstKeystrokeAtMs: 10_000,
      lastKeystrokeAtMs: 12_000,
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
    });

    expect(result.score).toBe(0);
  });
});

describe('lineTypingMs', () => {
  const base = {
    lineIndex: 0,
    target: 'alpha',
    typed: 'alpha',
    windowStartMs: WINDOW_START,
    windowEndMs: WINDOW_END,
  };

  it('measures first keystroke to completion', () => {
    expect(
      lineTypingMs({
        ...base,
        completedAtMs: 12_500,
        firstKeystrokeAtMs: 10_500,
        lastKeystrokeAtMs: 12_500,
      }),
    ).toBe(2_000);
  });

  it('stops the clock at completion, not at the end of the line window', () => {
    // The line stays on screen until 14_000; the player finished at 11_000. Only the 500ms they
    // spent typing counts — this is the whole point of the per-line measurement.
    expect(
      lineTypingMs({
        ...base,
        completedAtMs: 11_000,
        firstKeystrokeAtMs: 10_500,
        lastKeystrokeAtMs: 11_000,
      }),
    ).toBe(500);
  });

  it('ignores keystrokes after completion', () => {
    // Backspacing and retyping after finishing must not reopen the clock.
    expect(
      lineTypingMs({
        ...base,
        completedAtMs: 11_000,
        firstKeystrokeAtMs: 10_000,
        lastKeystrokeAtMs: 13_500,
      }),
    ).toBe(1_000);
  });

  it('counts time spent on a line that was never finished', () => {
    expect(
      lineTypingMs({
        ...base,
        typed: 'alp',
        completedAtMs: null,
        firstKeystrokeAtMs: 10_000,
        lastKeystrokeAtMs: 11_200,
      }),
    ).toBe(1_200);
  });

  it('is zero for a line that was never typed', () => {
    expect(
      lineTypingMs({
        ...base,
        typed: '',
        completedAtMs: null,
        firstKeystrokeAtMs: null,
        lastKeystrokeAtMs: null,
      }),
    ).toBe(0);
  });

  it('never goes negative when an offset nudge shifts stamps mid-line', () => {
    expect(
      lineTypingMs({
        ...base,
        completedAtMs: 9_000,
        firstKeystrokeAtMs: 10_000,
        lastKeystrokeAtMs: 9_000,
      }),
    ).toBe(0);
  });
});

describe('summarizeRun', () => {
  // Two lines, 9 correct characters, 6 seconds of actual typing between them — but sung 4 seconds
  // apart inside a run that spans a full minute.
  const lines = [
    scoreLine({
      lineIndex: 0,
      target: 'alpha',
      typed: 'alpha',
      completedAtMs: 12_000,
      firstKeystrokeAtMs: 10_000,
      lastKeystrokeAtMs: 12_000,
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
    }),
    scoreLine({
      lineIndex: 1,
      target: 'bravo',
      typed: 'brav',
      completedAtMs: null,
      firstKeystrokeAtMs: 14_000,
      lastKeystrokeAtMs: 18_000,
      windowStartMs: 14_000,
      windowEndMs: 18_000,
    }),
  ];

  it('totals score and counts completed lines', () => {
    const summary = summarizeRun(lines, 60_000);

    expect(summary.totalScore).toBe(lines[0]!.score + lines[1]!.score);
    expect(summary.linesAttempted).toBe(2);
    expect(summary.linesCompleted).toBe(1);
  });

  it('reports accuracy as correct over typed', () => {
    // 9 correct of 9 typed.
    expect(summarizeRun(lines, 60_000).accuracy).toBeCloseTo(1, 5);
  });

  it('sums typing time per line rather than spanning the run', () => {
    expect(summarizeRun(lines, 60_000).typingMs).toBe(6_000);
  });

  it('computes WPM over time spent typing, not the runs wall clock', () => {
    // 9 correct chars in 6s of typing = 18 wpm at 5 chars per word. Measured against the 60s the
    // run actually took it would read 1.8 — the song's dead air, not the player's speed.
    expect(summarizeRun(lines, 60_000).wpm).toBeCloseTo(18, 5);
  });

  it('reports the wall-clock span separately', () => {
    expect(summarizeRun(lines, 60_000).elapsedMs).toBe(60_000);
  });

  it('returns zeroes rather than NaN for an empty run', () => {
    const summary = summarizeRun([], 0);

    expect(summary.accuracy).toBe(0);
    expect(summary.wpm).toBe(0);
    expect(summary.totalScore).toBe(0);
  });

  it('reports zero rather than infinity when no measurable time was spent', () => {
    // Every line finished on its opening keystroke: real input, but no interval to divide by.
    const instant = [
      scoreLine({
        lineIndex: 0,
        target: 'a',
        typed: 'a',
        completedAtMs: 10_000,
        firstKeystrokeAtMs: 10_000,
        lastKeystrokeAtMs: 10_000,
        windowStartMs: WINDOW_START,
        windowEndMs: WINDOW_END,
      }),
    ];

    expect(summarizeRun(instant, 5_000).wpm).toBe(0);
  });
});
