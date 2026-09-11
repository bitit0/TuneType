import { describe, it, expect } from 'vitest';
import type { RunSubmission } from '@shared/types';
import {
  AVATAR_COLORS,
  MAX_PHOTO_CHARS,
  applyRun,
  applyTrackBest,
  defaultAvatarColor,
  defaultDisplayName,
  deriveMetrics,
  emptyAccumulators,
  isAvatarColor,
  mergeKeyTally,
  isValidPhotoDataUri,
  normalizeDisplayName,
  toAccountStats,
} from './stats';

function run(overrides: Partial<RunSubmission> = {}): RunSubmission {
  return {
    lrclibId: 1,
    title: 'Test Track',
    artist: 'Test Artist',
    album: null,
    videoId: 'abc123',
    totalScore: 1_000,
    correctChars: 300,
    typedChars: 300,
    linesAttempted: 10,
    linesCompleted: 10,
    typingMs: 60_000,
    elapsedMs: 200_000,
    offsetMs: 0,
    requiredWpm: 60,
    keyTally: {},
    ...overrides,
  };
}

describe('deriveMetrics', () => {
  it('measures speed over typing time, not the length of the run', () => {
    // 300 correct chars in 60s of typing = 60 wpm, regardless of how long the song was.
    expect(deriveMetrics(300, 300, 60_000).wpm).toBeCloseTo(60, 5);
  });

  it('reports accuracy as correct over typed', () => {
    expect(deriveMetrics(150, 300, 60_000).accuracy).toBeCloseTo(0.5, 5);
  });

  it('returns zero rather than dividing by zero', () => {
    expect(deriveMetrics(0, 0, 0)).toEqual({ accuracy: 0, wpm: 0 });
    expect(deriveMetrics(50, 50, 0).wpm).toBe(0);
  });
});

describe('applyRun', () => {
  it('accumulates counts and keeps the best of each headline number', () => {
    const first = applyRun(emptyAccumulators(), run({ totalScore: 500 }), 40);
    const second = applyRun(first, run({ totalScore: 900 }), 30);

    expect(second.runs).toBe(2);
    expect(second.totalScore).toBe(1_400);
    expect(second.bestScore).toBe(900);
    // The slower second run must not overwrite the faster first.
    expect(second.bestWpm).toBe(40);
    expect(second.totalTypingMs).toBe(120_000);
  });

  it('weights lifetime accuracy by characters, not by run count', () => {
    // A perfect 10-character run followed by a 50%-accurate 990-character run. Averaging the two
    // percentages would claim ~75%; the truth is much closer to 50%.
    const stats = applyRun(
      applyRun(emptyAccumulators(), run({ correctChars: 10, typedChars: 10 }), 10),
      run({ correctChars: 495, typedChars: 990 }),
      10,
    );

    expect(toAccountStats(stats).accuracy).toBeCloseTo(505 / 1000, 5);
  });

  it('derives lifetime speed from summed typing time', () => {
    // Two runs, 300 correct chars each, one minute of typing each = 60 wpm overall.
    const stats = applyRun(applyRun(emptyAccumulators(), run(), 60), run(), 60);

    expect(toAccountStats(stats).wpm).toBeCloseTo(60, 5);
  });

  it('starts from zero without producing NaN', () => {
    const stats = toAccountStats(emptyAccumulators());

    expect(stats.accuracy).toBe(0);
    expect(stats.wpm).toBe(0);
    expect(stats.runs).toBe(0);
  });
});

describe('applyTrackBest', () => {
  it('tracks each dimension independently', () => {
    const fast = applyTrackBest(null, run(), { accuracy: 0.8, wpm: 90 }, 1_000);
    const accurate = applyTrackBest(fast, run({ totalScore: 400 }), { accuracy: 0.99, wpm: 50 }, 2_000);

    // The high-scoring fast run and the accurate slow run each keep their own record.
    expect(accurate.bestWpm).toBe(90);
    expect(accurate.bestAccuracy).toBeCloseTo(0.99, 5);
    expect(accurate.bestScore).toBe(1_000);
    expect(accurate.plays).toBe(2);
    expect(accurate.lastPlayedAt).toBe(2_000);
  });

  it('refreshes track metadata from the most recent play', () => {
    const first = applyTrackBest(null, run({ title: 'Typo' }), { accuracy: 1, wpm: 60 }, 1_000);
    const second = applyTrackBest(first, run({ title: 'Corrected' }), { accuracy: 1, wpm: 60 }, 2_000);

    expect(second.title).toBe('Corrected');
  });
});

describe('normalizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  ada   lovelace  ')).toBe('ada lovelace');
  });

  it('strips control characters rather than rejecting the name', () => {
    expect(normalizeDisplayName('ada\u0007love\u0000lace')).toBe('adalovelace');
  });

  it('rejects a name with nothing visible in it', () => {
    expect(normalizeDisplayName('   ')).toBeNull();
    expect(normalizeDisplayName('\u0001\u0002')).toBeNull();
    expect(normalizeDisplayName('a')).toBeNull();
  });

  it('truncates rather than rejecting an over-long name', () => {
    expect(normalizeDisplayName('x'.repeat(100))).toHaveLength(24);
  });
});

describe('defaultDisplayName', () => {
  it('prefers the name the provider supplied', () => {
    expect(defaultDisplayName('Ada Lovelace', 'ada@example.com', 'uid123')).toBe('Ada Lovelace');
  });

  it('falls back to the email local-part when there is no provider name', () => {
    expect(defaultDisplayName(null, 'ada@example.com', 'uid123')).toBe('ada');
  });

  it('always produces something, even with no name and no email', () => {
    expect(defaultDisplayName(null, null, 'uid123456789')).toBe('player-uid123');
  });

  it('skips a provider name that normalizes away', () => {
    expect(defaultDisplayName('  ', 'ada@example.com', 'uid123')).toBe('ada');
  });
});

describe('defaultAvatarColor', () => {
  it('always returns a color from the palette', () => {
    for (const uid of ['a', 'uid123', '', 'Z'.repeat(64)]) {
      expect(AVATAR_COLORS).toContain(defaultAvatarColor(uid));
    }
  });

  it('is stable for the same uid', () => {
    // Re-provisioning a profile, or reading one written before avatars existed, must not shuffle
    // the color someone has got used to.
    expect(defaultAvatarColor('uid123')).toBe(defaultAvatarColor('uid123'));
  });

  it('spreads different uids across more than one color', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => defaultAvatarColor(`uid-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('isAvatarColor', () => {
  it('accepts palette members and rejects everything else', () => {
    expect(isAvatarColor('blue')).toBe(true);
    expect(isAvatarColor('chartreuse')).toBe(false);
    expect(isAvatarColor(null)).toBe(false);
    expect(isAvatarColor(7)).toBe(false);
  });
});

describe('isValidPhotoDataUri', () => {
  // 4 base64 chars = 3 bytes; content is irrelevant to the check, only the envelope matters.
  const payload = 'AAAA';

  it('accepts the raster formats the client can produce', () => {
    expect(isValidPhotoDataUri(`data:image/webp;base64,${payload}`)).toBe(true);
    expect(isValidPhotoDataUri(`data:image/png;base64,${payload}`)).toBe(true);
    expect(isValidPhotoDataUri(`data:image/jpeg;base64,${payload}`)).toBe(true);
  });

  it('rejects SVG, which can carry script', () => {
    // The security-relevant case: an SVG rendered from a same-origin data URI could execute.
    expect(isValidPhotoDataUri(`data:image/svg+xml;base64,${payload}`)).toBe(false);
  });

  it('rejects non-image and non-data URIs', () => {
    expect(isValidPhotoDataUri(`data:text/html;base64,${payload}`)).toBe(false);
    expect(isValidPhotoDataUri('https://example.com/cat.png')).toBe(false);
    expect(isValidPhotoDataUri('javascript:alert(1)')).toBe(false);
    expect(isValidPhotoDataUri('')).toBe(false);
  });

  it('rejects a payload that is not well-formed base64', () => {
    expect(isValidPhotoDataUri('data:image/png;base64,AA A')).toBe(false);
    expect(isValidPhotoDataUri('data:image/png;base64,AAA')).toBe(false);
    expect(isValidPhotoDataUri('data:image/png;base64,')).toBe(false);
  });

  it('rejects anything over the size cap', () => {
    const huge = `data:image/webp;base64,${'A'.repeat(MAX_PHOTO_CHARS)}`;
    expect(isValidPhotoDataUri(huge)).toBe(false);
  });

  it('accepts padding', () => {
    expect(isValidPhotoDataUri('data:image/png;base64,AAA=')).toBe(true);
    expect(isValidPhotoDataUri('data:image/png;base64,AA==')).toBe(true);
  });
});

describe('mergeKeyTally', () => {
  it('sums attempts and misses per key across runs', () => {
    const merged = mergeKeyTally(
      { e: { attempts: 10, misses: 2 }, a: { attempts: 5, misses: 0 } },
      { e: { attempts: 4, misses: 3 }, z: { attempts: 1, misses: 1 } },
    );

    expect(merged).toEqual({
      e: { attempts: 14, misses: 5 },
      a: { attempts: 5, misses: 0 },
      z: { attempts: 1, misses: 1 },
    });
  });

  it('does not mutate either side, since a transaction can retry', () => {
    const lifetime = { e: { attempts: 10, misses: 2 } };
    mergeKeyTally(lifetime, { e: { attempts: 4, misses: 3 } });

    expect(lifetime).toEqual({ e: { attempts: 10, misses: 2 } });
  });

  it('carries a run tally through applyRun into the lifetime totals', () => {
    const after = applyRun(emptyAccumulators(), run({ keyTally: { r: { attempts: 8, misses: 3 } } }), 60);
    expect(after.keyTally).toEqual({ r: { attempts: 8, misses: 3 } });
  });
});
