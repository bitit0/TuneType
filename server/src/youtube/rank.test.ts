import { describe, expect, it } from 'vitest';
import type { VideoCandidate } from '@shared/types';
import {
  classifyTier,
  disqualifyingReason,
  normalizeText,
  parseIsoDuration,
  rankCandidates,
  searchCacheKey,
  type TrackForRanking,
} from './rank.js';

/**
 * Fixtures are invented, but the *shapes* are copied from real YouTube results: the trailing
 * "- Topic", the "(Official Music Video)" suffix, the VEVO channel. Those conventions are what the
 * heuristics key on, so a fixture that tidies them up would test nothing.
 */

const TRACK: TrackForRanking = { title: 'Paper Kites', artist: 'Halcyon Bay', durationSec: 233 };

function video(partial: Partial<VideoCandidate>): VideoCandidate {
  return {
    videoId: 'abc12345678',
    title: 'Paper Kites',
    channelTitle: 'Halcyon Bay - Topic',
    durationSec: 233,
    ...partial,
  };
}

describe('parseIsoDuration', () => {
  it('parses the forms videos.list actually returns', () => {
    expect(parseIsoDuration('PT4M13S')).toBe(253);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT2M')).toBe(120);
  });

  it('treats a live stream as zero length rather than as unparseable', () => {
    // P0D is what an ongoing broadcast reports. Zero then loses to the shortfall rule, which is
    // the outcome we want — a live stream has no fixed start to sync against.
    expect(parseIsoDuration('P0D')).toBe(0);
  });

  it('returns null for anything it does not understand', () => {
    expect(parseIsoDuration('4:13')).toBeNull();
    expect(parseIsoDuration('')).toBeNull();
  });
});

describe('normalizeText', () => {
  it('folds accents so the same artist compares equal either way', () => {
    expect(normalizeText('Beyoncé')).toBe(normalizeText('Beyonce'));
  });

  it('flattens punctuation and case', () => {
    expect(normalizeText("Don't Stop — Me, Now!")).toBe('dont stop me now');
  });
});

describe('searchCacheKey', () => {
  it('collapses the single, album and reissue entries of one recording onto one key', () => {
    // The whole point: three LRCLIB ids, three durations, one search.
    const single = searchCacheKey({ title: 'Paper Kites', artist: 'Halcyon Bay', durationSec: 233 });
    const album = searchCacheKey({ title: 'paper kites', artist: 'HALCYON BAY', durationSec: 235 });
    expect(single).toBe(album);
  });
});

describe('classifyTier', () => {
  it('puts a Topic channel above everything else', () => {
    expect(classifyTier(video({ channelTitle: 'Halcyon Bay - Topic' }), TRACK)).toBe('topic');
  });

  it('requires the exact ASCII "- Topic" suffix YouTube generates', () => {
    // Deliberately strict. Topic channels are machine-generated and always use a plain hyphen, so
    // an en dash means a human named the channel that way — and this tier is the one signal that
    // gets believed without further checks, which makes it the one worth impersonating.
    expect(classifyTier(video({ channelTitle: 'Halcyon Bay – Topic' }), TRACK)).not.toBe('topic');
  });

  it('reads official audio and full-album uploads as official', () => {
    expect(
      classifyTier(video({ title: 'Paper Kites (Official Audio)', channelTitle: 'Some Uploader' }), TRACK),
    ).toBe('official');
    expect(
      classifyTier(video({ title: 'Halcyon Bay - Full Album', channelTitle: 'Some Uploader' }), TRACK),
    ).toBe('official');
  });

  it('ranks a lyric video above the official music video', () => {
    const lyric = classifyTier(
      video({ title: 'Paper Kites (Lyrics)', channelTitle: 'LyricVault' }),
      TRACK,
    );
    const mv = classifyTier(
      video({ title: 'Paper Kites (Official Music Video)', channelTitle: 'HalcyonBayVEVO' }),
      TRACK,
    );
    expect(lyric).toBe('lyric');
    expect(mv).toBe('musicvideo');
  });

  it('treats a plain upload from the artist channel as official, and from anyone else as other', () => {
    expect(classifyTier(video({ title: 'Paper Kites', channelTitle: 'Halcyon Bay' }), TRACK)).toBe(
      'official',
    );
    expect(classifyTier(video({ title: 'Paper Kites', channelTitle: 'randomuser99' }), TRACK)).toBe(
      'other',
    );
  });
});

describe('disqualifyingReason', () => {
  it('catches recordings an offset could never reconcile', () => {
    expect(disqualifyingReason('Paper Kites (Karaoke Version)', 'Paper Kites')).toBe('karaoke version');
    expect(disqualifyingReason('Paper Kites - Live at Wembley', 'Paper Kites')).toBe('live performance');
    expect(disqualifyingReason('Paper Kites (Live)', 'Paper Kites')).toBe('live performance');
    expect(disqualifyingReason('Paper Kites (Nightcore)', 'Paper Kites')).toBe('nightcore edit');
  });

  it('does not reject a song for its own title', () => {
    // The failure this prevents: searching for a song called "Live Forever" and rejecting every
    // result, including the correct one, because they all say "live".
    expect(disqualifyingReason('Live Forever (Official Audio)', 'Live Forever')).toBeNull();
    expect(disqualifyingReason('Paper Kites (Sunset Remix)', 'Paper Kites (Sunset Remix)')).toBeNull();
  });

  it('leaves an ordinary title alone', () => {
    expect(disqualifyingReason('Paper Kites (Official Audio)', 'Paper Kites')).toBeNull();
  });
});

describe('rankCandidates', () => {
  it('orders by tier before anything else', () => {
    const ranked = rankCandidates(
      [
        video({ videoId: 'mv', title: 'Paper Kites (Official Music Video)', channelTitle: 'HalcyonBayVEVO' }),
        video({ videoId: 'lyric', title: 'Paper Kites (Lyrics)', channelTitle: 'LyricVault' }),
        video({ videoId: 'topic', channelTitle: 'Halcyon Bay - Topic' }),
      ],
      TRACK,
    );

    expect(ranked.map((c) => c.videoId)).toEqual(['topic', 'lyric', 'mv']);
  });

  it('prefers the smallest positive duration delta within a tier', () => {
    const ranked = rankCandidates(
      [
        video({ videoId: 'long', durationSec: 233 + 45 }),
        video({ videoId: 'tight', durationSec: 233 + 2 }),
      ],
      TRACK,
    );

    expect(ranked[0]?.videoId).toBe('tight');
    expect(ranked[0]?.durationDeltaSec).toBe(2);
  });

  it('rejects anything shorter than the track, and says why', () => {
    const [candidate] = rankCandidates([video({ durationSec: 233 - 40 })], TRACK);

    expect(candidate?.rejected).toBe(true);
    expect(candidate?.rejectionReason).toMatch(/shorter/);
  });

  it('tolerates a second or two of shortfall as rounding, not as a radio edit', () => {
    // LRCLIB durations are user-supplied and YouTube reports whole seconds; a one-second
    // disagreement is the two sources rounding, not a different cut.
    const [candidate] = rankCandidates([video({ durationSec: 232 })], TRACK);
    expect(candidate?.rejected).toBe(false);
  });

  it('rejects a full-album upload despite it being on the right channel', () => {
    const [candidate] = rankCandidates(
      [video({ title: 'Halcyon Bay - Full Album', durationSec: 2400 })],
      TRACK,
    );

    expect(candidate?.rejected).toBe(true);
    expect(candidate?.rejectionReason).toMatch(/full album|compilation/);
  });

  it('keeps rejected candidates, sorted last, rather than dropping them', () => {
    // A track whose only upload we cannot vouch for should still be playable by someone who can
    // look at the video and decide for themselves.
    const ranked = rankCandidates(
      [
        video({ videoId: 'karaoke', title: 'Paper Kites (Karaoke)' }),
        video({ videoId: 'good' }),
      ],
      TRACK,
    );

    expect(ranked).toHaveLength(2);
    expect(ranked.map((c) => c.videoId)).toEqual(['good', 'karaoke']);
    expect(ranked[1]?.rejected).toBe(true);
  });

  it('skips the duration check when LRCLIB has no duration, instead of guessing', () => {
    const ranked = rankCandidates(
      [video({ durationSec: 12 })],
      { ...TRACK, durationSec: null },
    );

    expect(ranked[0]?.rejected).toBe(false);
    // Null, not zero: "could not check" must not be able to look like an exact length match.
    expect(ranked[0]?.durationDeltaSec).toBeNull();
    expect(ranked[0]?.notes.join(' ')).toMatch(/not checked/);
  });

  it('promotes a video players have successfully timed over its unproven peers', () => {
    // Evidence beats inference between comparable candidates. It does not beat a whole tier: an
    // unplayed Topic upload has no submissions because nobody has tried it, which is not a mark
    // against it — see the note on CONFIRMED_OFFSET_BONUS.
    const ranked = rankCandidates(
      [
        video({ videoId: 'unproven', title: 'Paper Kites (Lyrics)', channelTitle: 'OtherLyrics' }),
        video({ videoId: 'proven', title: 'Paper Kites (Lyrics)', channelTitle: 'LyricVault' }),
      ],
      TRACK,
      new Map([
        [
          'proven',
          {
            consensusOffsetMs: 2_400,
            confidence: 'confirmed' as const,
            submissionCount: 4,
            agreeingCount: 4,
            spreadMs: 40,
          },
        ],
      ]),
    );

    expect(ranked[0]?.videoId).toBe('proven');
    expect(ranked[0]?.notes.join(' ')).toMatch(/confirmed by 4/);
  });

  it('rejects a video whose timings cannot be reconciled', () => {
    // High spread is a wrong-video signal, not a timing problem: no single offset will ever fit,
    // because the submitters are not listening to the same recording.
    const ranked = rankCandidates(
      [
        video({ videoId: 'contested', channelTitle: 'Halcyon Bay - Topic' }),
        video({ videoId: 'ordinary', title: 'Paper Kites (Lyrics)', channelTitle: 'LyricVault' }),
      ],
      TRACK,
      new Map([
        [
          'contested',
          {
            consensusOffsetMs: 5_000,
            confidence: 'contested' as const,
            submissionCount: 5,
            agreeingCount: 2,
            spreadMs: 6_000,
          },
        ],
      ]),
    );

    // Demoted below an ordinary candidate despite being the top tier on metadata alone.
    expect(ranked[0]?.videoId).toBe('ordinary');
    expect(ranked[1]?.rejected).toBe(true);
    expect(ranked[1]?.rejectionReason).toMatch(/disagree/);
  });

  it('does not let one measurement outweigh the tier ordering', () => {
    // One person can be wrong. A provisional timing is a nudge, not a promotion past a Topic
    // upload that simply has not been played yet.
    const ranked = rankCandidates(
      [
        video({ videoId: 'topic', channelTitle: 'Halcyon Bay - Topic' }),
        video({ videoId: 'once', title: 'Paper Kites (Lyrics)', channelTitle: 'LyricVault' }),
      ],
      TRACK,
      new Map([
        [
          'once',
          {
            consensusOffsetMs: 2_400,
            confidence: 'provisional' as const,
            submissionCount: 1,
            agreeingCount: 1,
            spreadMs: 0,
          },
        ],
      ]),
    );

    expect(ranked[0]?.videoId).toBe('topic');
  });

  it('penalizes a title that never mentions the track', () => {
    const ranked = rankCandidates(
      [
        video({ videoId: 'named', title: 'Paper Kites', channelTitle: 'LyricVault' }),
        video({ videoId: 'unnamed', title: 'Halcyon Bay Mix 2019', channelTitle: 'LyricVault' }),
      ],
      TRACK,
    );

    expect(ranked[0]?.videoId).toBe('named');
  });
});
