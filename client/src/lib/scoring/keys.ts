import type { Keystroke } from '@shared/types';

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
 * Which keys the player actually misses, worst first.
 *
 * Sorted by miss count rather than miss rate. A rate over one or two attempts is noise — a key hit
 * once and fluffed reads as 100% wrong — and ranking by count lets rare keys sink on their own,
 * without a minimum-attempts threshold to pick and defend.
 *
 * Case is folded because the question is which key gets missed, and 'a' and 'A' are one key. A
 * missed shift still counts against it: the keystroke was wrong either way.
 */
export function keyErrorRates(keystrokes: Keystroke[]): KeyErrors[] {
  const byKey = new Map<string, { attempts: number; misses: number }>();

  for (const stroke of keystrokes) {
    // Typing past the end of a line expects nothing, so there is no key to blame.
    if (stroke.expected === null) continue;

    const key = stroke.expected.toLowerCase();
    const entry = byKey.get(key) ?? { attempts: 0, misses: 0 };
    entry.attempts++;
    if (!stroke.correct) entry.misses++;
    byKey.set(key, entry);
  }

  return [...byKey]
    .filter(([, entry]) => entry.misses > 0)
    .map(([key, entry]) => ({
      key,
      attempts: entry.attempts,
      misses: entry.misses,
      rate: entry.misses / entry.attempts,
    }))
    .sort((a, b) => b.misses - a.misses || b.rate - a.rate);
}
