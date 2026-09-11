import type { KeyTally, LyricLine } from '@shared/types';

/**
 * Picking songs that punish the keys you actually miss.
 *
 * This runs in the browser, and that placement is the whole design rather than an implementation
 * detail. Ranking a song by which keys it loads requires its letter distribution, and a letter
 * distribution stored against one track is a frequency profile of that track's words — the exact
 * thing `RunSubmission` refuses to persist, and the reason lifetime key counts are summed across
 * every song before they are saved.
 *
 * So nothing here is stored or sent. Lyrics are fetched for the comparison, measured, and dropped,
 * the same way they are for a run.
 */

/**
 * How much evidence a key needs before its own miss rate is trusted over the player's average.
 *
 * Without this a key typed twice and missed once reads as a 50% weakness and outranks a letter
 * missed two hundred times out of three thousand. Twenty is roughly where a rate starts meaning
 * something; below it the estimate leans on the overall rate instead, and the pull fades as real
 * attempts accumulate.
 */
const EVIDENCE_PRIOR = 20;

/** Keys that carry no practice signal. Space is typed constantly and missed almost never. */
const IGNORED = new Set([' ']);

export interface KeyWeights {
  /** Estimated miss rate per key, shrunk toward `baseline` when evidence is thin. */
  rate: Map<string, number>;
  /** The player's overall miss rate. What an unseen key is assumed to cost. */
  baseline: number;
}

/**
 * Turns raw counts into a per-key miss rate worth ranking on.
 *
 * Each key's rate is pulled toward the player's own average in proportion to how little has been
 * seen of it, which is the standard fix for comparing rates over wildly different sample sizes.
 * A key nobody has met yet simply gets the average.
 */
export function keyWeights(tally: KeyTally): KeyWeights {
  let totalAttempts = 0;
  let totalMisses = 0;

  for (const [key, entry] of Object.entries(tally)) {
    if (IGNORED.has(key)) continue;
    totalAttempts += entry.attempts;
    totalMisses += entry.misses;
  }

  const baseline = totalAttempts === 0 ? 0 : totalMisses / totalAttempts;
  const rate = new Map<string, number>();

  for (const [key, entry] of Object.entries(tally)) {
    if (IGNORED.has(key)) continue;
    rate.set(
      key,
      (entry.misses + EVIDENCE_PRIOR * baseline) / (entry.attempts + EVIDENCE_PRIOR),
    );
  }

  return { rate, baseline };
}

export interface PracticeFit {
  /** Mean expected miss rate across the song's characters. Higher means more punishing. */
  load: number;
  /** The keys contributing most of that load, worst first. What makes the pick explainable. */
  culprits: string[];
}

/** How many keys to name. Three is enough to recognise a pattern and short enough to read. */
const CULPRIT_COUNT = 3;

/**
 * Scores how heavily a song leans on this player's weak keys.
 *
 * The load is a mean rather than a sum, so a long song does not outrank a hard one purely by
 * having more characters in it. Total volume is already visible as the line count and required
 * pace; this answers a different question.
 */
export function practiceFit(lines: LyricLine[], weights: KeyWeights): PracticeFit {
  const contribution = new Map<string, number>();
  let total = 0;
  let count = 0;

  for (const line of lines) {
    for (const char of line.text.toLowerCase()) {
      if (IGNORED.has(char)) continue;

      const rate = weights.rate.get(char) ?? weights.baseline;
      total += rate;
      count++;
      contribution.set(char, (contribution.get(char) ?? 0) + rate);
    }
  }

  if (count === 0) return { load: 0, culprits: [] };

  const culprits = [...contribution.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CULPRIT_COUNT)
    .map(([key]) => key);

  return { load: total / count, culprits };
}
