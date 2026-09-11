import type { OffsetConfidence, OffsetConsensus, OffsetSubmission } from '@shared/types';

/**
 * Turning a pile of noisy human offset submissions into one number.
 *
 * This is the part of the project that has to work for anything else about the offset store to
 * matter. The offset cannot be computed — the player is a cross-origin iframe, there is no access
 * to audio samples, and so the only source of truth is a person pressing a key when they hear the
 * first line. That means every input is noisy, and some are simply wrong: a mistap, someone
 * calibrating against the second chorus, a browser that stalled for half a second.
 *
 * Pure functions, no Firestore. The interesting behaviour is arithmetic and deserves to be tested
 * as arithmetic.
 */

// --- Tunables ---------------------------------------------------------------------------------

/**
 * How close two submissions must be to count as agreeing, in milliseconds.
 *
 * Set against human reaction time, not against precision. Tap calibration measures when someone
 * *noticed* the vocal, and reaction time varies by a couple of hundred milliseconds between people
 * and between attempts by the same person. Tighter than this and genuine agreement looks like
 * disagreement; much wider and a wrong-video signal gets absorbed as noise.
 */
export const AGREEMENT_WINDOW_MS = 400;

/** Submissions needed before an offset stops being provisional. */
export const CONFIRMED_MIN_SUBMISSIONS = 3;

/**
 * Share of submissions that must fall inside the agreement window for a consensus to be confirmed.
 *
 * Two thirds rather than a bare majority: the interesting failure is a video with two populations
 * of submitters — people who calibrated against the intro and people who calibrated against the
 * first vocal — and an even split there means we do not yet know which is right.
 */
export const CONFIRMED_MIN_AGREEMENT = 2 / 3;

/**
 * Spread above which the video itself is suspect rather than the timing.
 *
 * This is the feedback loop the whole design turns on. Submissions that disagree by seconds are
 * not people being imprecise — they are people watching different arrangements. A live cut, an
 * extended mix or a fan edit produces exactly this signature, and it means the video should be
 * demoted from the match candidates rather than nudged.
 */
export const WRONG_VIDEO_SPREAD_MS = 2_000;

// --- Statistics -------------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;

  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Median absolute deviation, as the spread measure.
 *
 * Standard deviation was the obvious choice and is the wrong one here: it is defined against the
 * mean, so a single garbage submission inflates both the centre and the spread, and the "high
 * variance means wrong video" rule would then fire on one mistap. MAD moves only when *most*
 * submissions move, which is the property the rule actually needs.
 */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

/**
 * The consensus offset: the median of the largest group that agrees with itself.
 *
 * Clustering around the plain median was the first attempt and is subtly broken. On an even split
 * — two people calibrated against the intro, two against the first vocal — the median lands
 * *between* the two groups, in a gap where nobody submitted anything, and the offset it produces
 * is wrong for every single submitter. Seeking the densest cluster instead guarantees the answer
 * is a value some real group of people actually reported.
 *
 * Quadratic in the number of submissions, which is why the store caps them. At the cap it is a few
 * thousand comparisons on a write that happens once per calibration.
 */
function bestCluster(submissions: OffsetSubmission[]): { offsetMs: number; agreeing: number } {
  let best: { members: OffsetSubmission[]; newest: number } | null = null;

  for (const candidate of submissions) {
    const members = submissions.filter(
      (other) => Math.abs(other.offsetMs - candidate.offsetMs) <= AGREEMENT_WINDOW_MS,
    );
    const newest = Math.max(...members.map((member) => member.submittedAt));

    // Ties go to the more recent group. When two clusters are the same size there is no way to
    // know which is right from the numbers alone, but a video that was re-uploaded or replaced
    // makes older measurements the stale ones, so recency is the least arbitrary rule available.
    const better =
      best === null ||
      members.length > best.members.length ||
      (members.length === best.members.length && newest > best.newest);

    if (better) best = { members, newest };
  }

  if (!best) return { offsetMs: 0, agreeing: 0 };

  return {
    offsetMs: median(best.members.map((member) => member.offsetMs)),
    agreeing: best.members.length,
  };
}

// --- Consensus --------------------------------------------------------------------------------

/**
 * Grades how much an offset can be trusted.
 *
 * Three states rather than a boolean, because "one person has calibrated this" is genuinely
 * different from both "nobody has" and "several people agree". The design goal is that one
 * calibration makes the video playable for everyone after — but a single submission is also the
 * easiest thing in the system to get wrong, so it is applied *and* flagged, and the next player is
 * asked to confirm rather than being told it is settled.
 */
function confidenceFor(count: number, agreeing: number, spreadMs: number): OffsetConfidence {
  if (count === 0) return 'none';
  if (spreadMs > WRONG_VIDEO_SPREAD_MS) return 'contested';
  if (count >= CONFIRMED_MIN_SUBMISSIONS && agreeing / count >= CONFIRMED_MIN_AGREEMENT) {
    return 'confirmed';
  }
  return 'provisional';
}

export function computeConsensus(submissions: OffsetSubmission[]): OffsetConsensus {
  const values = submissions.map((submission) => submission.offsetMs);

  if (values.length === 0) {
    return {
      consensusOffsetMs: null,
      confidence: 'none',
      submissionCount: 0,
      agreeingCount: 0,
      spreadMs: 0,
    };
  }

  const { offsetMs, agreeing } = bestCluster(submissions);
  const spreadMs = medianAbsoluteDeviation(values);
  const confidence = confidenceFor(values.length, agreeing, spreadMs);

  return {
    // A contested video still reports its best guess. The client is told not to trust it and asks
    // for a fresh calibration, but withholding the number entirely would throw away the only
    // starting point a new calibrator has.
    consensusOffsetMs: Math.round(offsetMs),
    confidence,
    submissionCount: values.length,
    agreeingCount: agreeing,
    spreadMs: Math.round(spreadMs),
  };
}

/**
 * Whether this video should be demoted in the search ranking.
 *
 * The signal is disagreement, not the size of the offset. A video needing a nine-second correction
 * is fine once someone has measured it — that is a title card, and it is exactly what the offset
 * store is for. A video whose submissions disagree by seconds is a video where people are hearing
 * different things, and no single offset will ever be right for it.
 */
export function isWrongVideoSignal(consensus: OffsetConsensus): boolean {
  return (
    consensus.submissionCount >= CONFIRMED_MIN_SUBMISSIONS &&
    consensus.spreadMs > WRONG_VIDEO_SPREAD_MS
  );
}
