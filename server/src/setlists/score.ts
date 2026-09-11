import type { LineSpec, VerifiedLineClaim } from '@shared/types';

/**
 * Scoring a curated run on the server.
 *
 * Everywhere else in this project, scoring happens in the browser against lyrics the server never
 * sees, so the server has nothing to recompute a run from and a posted score has to be taken on
 * faith. That is fine for a private history and not fine for a leaderboard, where one person's
 * number is compared against another's.
 *
 * Curated entries are the exception, because a `scoreProfile` is stored with them — per-line
 * lengths and windows, which are numbers rather than words and so sit inside the same rule that
 * already allows `requiredWpm`. With those, the server can price a run itself.
 *
 * What this does NOT do is make scores trustworthy. A client can still claim line results it never
 * earned, and nothing reachable from a cross-origin iframe will ever prove otherwise. Three things
 * do change:
 *
 * - a run cannot assert a score, only the per-line facts a score is derived from;
 * - every claim is bounded by the entry's real line lengths and windows, so the arithmetic has a
 *   ceiling that does not depend on the client;
 * - two players are scored by one implementation instead of by whatever each browser ran.
 *
 * Treat the result as "consistently computed", not as "proven".
 */

/*
 * Duplicated from `client/src/lib/scoring/constants.ts`, for the same reason `CHARS_PER_WORD` is
 * duplicated in the accounts module: `shared/` is type-only, so nothing in it survives compilation
 * and promoting a constant there would end that property.
 *
 * These four must agree with the client's copies. They are the definition of a score, and a run
 * priced differently in the browser than on the leaderboard is a bug a player will notice
 * immediately — the results screen and the standings would disagree about the same run.
 */
const POINTS_PER_CORRECT_CHAR = 10;
const TIMING_FLOOR_MULTIPLIER = 0.5;
const LATE_DECAY_WINDOWS = 1;
const PENALIZE_EARLY = false;
const CHARS_PER_WORD = 5;

/** Mirrors `timingMultiplier` in the client's scoring module. */
export function timingMultiplier(
  completedAtMs: number | null,
  windowStartMs: number,
  windowEndMs: number,
): number {
  if (completedAtMs === null) return TIMING_FLOOR_MULTIPLIER;

  if (completedAtMs < windowStartMs) {
    return PENALIZE_EARLY ? TIMING_FLOOR_MULTIPLIER : 1;
  }

  if (completedAtMs <= windowEndMs) return 1;

  const windowLengthMs = Math.max(1, windowEndMs - windowStartMs);
  const graceMs = windowLengthMs * LATE_DECAY_WINDOWS;
  const lateBy = completedAtMs - windowEndMs;

  if (lateBy >= graceMs) return TIMING_FLOOR_MULTIPLIER;

  return 1 - (lateBy / graceMs) * (1 - TIMING_FLOOR_MULTIPLIER);
}

export class InvalidRunError extends Error {}

export interface VerifiedScore {
  totalScore: number;
  correctChars: number;
  typedChars: number;
  accuracy: number;
  wpm: number;
  typingMs: number;
  linesAttempted: number;
  linesCompleted: number;
}

/**
 * Prices a run against the entry it was played on.
 *
 * Every check here rejects rather than clamps. A claim outside what the profile allows is not a
 * run that needs tidying up — it is a client reporting something that cannot have happened, and
 * silently repairing it would put a number on the leaderboard that nothing produced.
 */
export function scoreVerifiedRun(profile: LineSpec[], claims: VerifiedLineClaim[]): VerifiedScore {
  if (profile.length === 0) {
    throw new InvalidRunError('This entry has no scoring profile, so runs on it cannot be scored.');
  }

  if (claims.length > profile.length) {
    throw new InvalidRunError('More lines were reported than the song has.');
  }

  const seen = new Set<number>();
  let totalScore = 0;
  let correctChars = 0;
  let typedChars = 0;
  let typingMs = 0;
  let linesCompleted = 0;

  for (const claim of claims) {
    const line = profile[claim.i];
    if (!line) throw new InvalidRunError(`Line ${claim.i} is not in this song.`);

    // A repeated index would let one line be scored several times over.
    if (seen.has(claim.i)) throw new InvalidRunError(`Line ${claim.i} was reported twice.`);
    seen.add(claim.i);

    if (claim.correct > claim.typed) {
      throw new InvalidRunError(`Line ${claim.i} reports more correct characters than typed.`);
    }

    // The ceiling that makes the rest of this arithmetic mean anything. Overtyping is impossible in
    // the client — it stops accepting input at the end of a line — so a claim past the real length
    // is either a broken client or a fabricated one.
    if (claim.typed > line.len) {
      throw new InvalidRunError(`Line ${claim.i} reports more characters than the line contains.`);
    }

    const multiplier = timingMultiplier(claim.doneAtMs, line.startMs, line.endMs);

    totalScore += Math.round(claim.correct * POINTS_PER_CORRECT_CHAR * multiplier);
    correctChars += claim.correct;
    typedChars += claim.typed;
    typingMs += claim.typingMs;
    if (claim.doneAtMs !== null) linesCompleted++;
  }

  const minutes = typingMs / 60_000;

  return {
    totalScore,
    correctChars,
    typedChars,
    accuracy: typedChars === 0 ? 0 : correctChars / typedChars,
    wpm: minutes <= 0 ? 0 : correctChars / CHARS_PER_WORD / minutes,
    typingMs,
    linesAttempted: claims.length,
    linesCompleted,
  };
}
