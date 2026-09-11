import { describe, expect, it } from 'vitest';
import type { OffsetSubmission } from '@shared/types';
import {
  AGREEMENT_WINDOW_MS,
  computeConsensus,
  isWrongVideoSignal,
  median,
  medianAbsoluteDeviation,
  WRONG_VIDEO_SPREAD_MS,
} from './consensus.js';

function subs(...offsets: number[]): OffsetSubmission[] {
  return offsets.map((offsetMs, i) => ({
    offsetMs,
    submittedAt: 1_700_000_000_000 + i * 1_000,
    uid: null,
    source: 'tap' as const,
  }));
}

describe('median', () => {
  it('takes the middle value, and the midpoint of the middle pair', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
  });

  it('is unmoved by one wild value', () => {
    // The whole reason the design specifies median over mean. The mean here is over 25,000.
    expect(median([1_000, 1_100, 1_050, 120_000])).toBe(1_075);
  });
});

describe('medianAbsoluteDeviation', () => {
  it('stays small when one submission is garbage', () => {
    // Standard deviation on this sample is in the tens of thousands, which would trip the
    // wrong-video rule on a video that three people agree about.
    expect(medianAbsoluteDeviation([1_000, 1_050, 1_100, 90_000])).toBeLessThan(200);
  });

  it('grows when the submissions genuinely disagree', () => {
    expect(medianAbsoluteDeviation([0, 4_000, 8_000, 12_000])).toBeGreaterThan(WRONG_VIDEO_SPREAD_MS);
  });
});

describe('computeConsensus', () => {
  it('reports nothing to go on when nobody has calibrated', () => {
    expect(computeConsensus([])).toMatchObject({
      consensusOffsetMs: null,
      confidence: 'none',
      submissionCount: 0,
    });
  });

  it('applies a single submission, but flags it as provisional', () => {
    // The coverage-compounding property: one person calibrates and everyone after gets it right on
    // first play. It is also the easiest value in the system to have wrong, hence the flag.
    expect(computeConsensus(subs(2_400))).toMatchObject({
      consensusOffsetMs: 2_400,
      confidence: 'provisional',
      submissionCount: 1,
    });
  });

  it('confirms once enough submissions agree closely', () => {
    const result = computeConsensus(subs(2_400, 2_500, 2_350));

    expect(result.confidence).toBe('confirmed');
    expect(result.consensusOffsetMs).toBeCloseTo(2_400, -2);
    expect(result.agreeingCount).toBe(3);
  });

  it('ignores an outlier instead of splitting the difference with it', () => {
    // Someone calibrated against the wrong section. The answer must stay where the cluster is.
    const result = computeConsensus(subs(2_400, 2_450, 2_380, 47_000));

    expect(result.consensusOffsetMs).toBeLessThan(3_000);
    expect(result.agreeingCount).toBe(3);
    expect(result.submissionCount).toBe(4);
  });

  it('lands on a real cluster rather than between two of them', () => {
    // An even split: two people heard the intro, two heard the first vocal. A plain median would
    // return ~3000ms, which matches neither group and is right for nobody.
    const result = computeConsensus(subs(1_000, 1_050, 5_000, 5_050));

    expect([1_025, 5_025]).toContain(result.consensusOffsetMs);
  });

  it('marks a video contested when submissions disagree by seconds', () => {
    // Not a timing problem. People are watching different arrangements.
    const result = computeConsensus(subs(0, 5_000, 11_000, 16_000));

    expect(result.confidence).toBe('contested');
    expect(isWrongVideoSignal(result)).toBe(true);
  });

  it('does not confirm while a substantial minority disagrees', () => {
    // Four agree, three do not — a bare majority, and not enough. The interesting failure this
    // guards is a video where two populations each measured something real.
    const result = computeConsensus(subs(1_000, 1_050, 1_020, 1_010, 1_900, 2_000, 2_100));

    expect(result.confidence).toBe('provisional');
    expect(result.agreeingCount).toBe(4);
    expect(result.submissionCount).toBe(7);
  });

  it('treats a large but agreed offset as fine, not as suspect', () => {
    // Nine seconds of title card is exactly what this store exists to absorb. Size is not the
    // signal; disagreement is.
    const result = computeConsensus(subs(9_000, 9_100, 8_950, 9_050));

    expect(result.confidence).toBe('confirmed');
    expect(isWrongVideoSignal(result)).toBe(false);
  });

  it('counts submissions just inside the agreement window as agreeing', () => {
    const inside = computeConsensus(subs(0, AGREEMENT_WINDOW_MS - 10, -(AGREEMENT_WINDOW_MS - 10)));
    expect(inside.agreeingCount).toBe(3);
  });

  it('needs more than one submission before a wrong-video call', () => {
    // One person can be wrong on their own; that is not evidence about the video.
    expect(isWrongVideoSignal(computeConsensus(subs(30_000)))).toBe(false);
  });
});
