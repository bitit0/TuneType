import type { KeyTally, Keystroke } from '@shared/types';

/** One expected character and how often the player got it wrong. */
export interface KeyErrors {
  /** The expected character, lowercased. */
  key: string;
  attempts: number;
  misses: number;
  /** Misses as a share of attempts, 0-1. */
  rate: number;
}

/**
 * Counts every keystroke against the key it was aimed at.
 *
 * Case is folded because the question is which key gets missed, and 'a' and 'A' are one key. A
 * missed shift still counts against it: the keystroke was wrong either way.
 *
 * This is the shape that travels to the server and accumulates over an account's lifetime, which
 * is why it is a plain tally of two numbers per key and carries no order. A histogram of which
 * letters came up cannot reconstruct the words they came from — see `RunSubmission`.
 */
export function tallyKeys(keystrokes: Keystroke[]): KeyTally {
  const tally: KeyTally = {};

  for (const stroke of keystrokes) {
    // Typing past the end of a line expects nothing, so there is no key to blame.
    if (stroke.expected === null) continue;

    const key = stroke.expected.toLowerCase();
    const entry = (tally[key] ??= { attempts: 0, misses: 0 });
    entry.attempts++;
    if (!stroke.correct) entry.misses++;
  }

  return tally;
}

/**
 * Which keys are actually missed, worst first.
 *
 * Sorted by miss count rather than miss rate. A rate over one or two attempts is noise — a key hit
 * once and fluffed reads as 100% wrong — and ranking by count lets rare keys sink on their own,
 * without a minimum-attempts threshold to pick and defend.
 *
 * Takes a tally rather than keystrokes so the results screen and the profile rank by the identical
 * rule. One is a single run's keystrokes, the other an account's lifetime totals read back from
 * the server, and they should not be able to disagree about what "worst" means.
 */
export function rankKeyErrors(tally: KeyTally): KeyErrors[] {
  return Object.entries(tally)
    .filter(([, entry]) => entry.misses > 0)
    .map(([key, entry]) => ({
      key,
      attempts: entry.attempts,
      misses: entry.misses,
      rate: entry.attempts === 0 ? 0 : entry.misses / entry.attempts,
    }))
    .sort((a, b) => b.misses - a.misses || b.rate - a.rate);
}

/** One run's keystrokes, ranked. What the results screen shows. */
export function keyErrorRates(keystrokes: Keystroke[]): KeyErrors[] {
  return rankKeyErrors(tallyKeys(keystrokes));
}
