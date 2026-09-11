import { describe, expect, it } from 'vitest';
import type { LrcTimeMs, LyricLine, PlayableTrack } from '@shared/types';
import { parseVideoTitle, pickTrackForVideo } from './match';

/**
 * Fixtures are synthetic — invented artists, invented songs. Nothing in this repo is lyrics
 * content, and a test file is not an exception to that.
 */

const LINES: LyricLine[] = [{ startMs: 0 as LrcTimeMs, endMs: 1_000 as LrcTimeMs, text: 'aaa' }];

function track(id: number, title: string, durationSec: number | null): PlayableTrack {
  return { lrclibId: id, title, artist: 'Nineteen Hollows', album: null, durationSec, lines: LINES };
}

describe('parseVideoTitle', () => {
  it('splits artist from title and drops decoration', () => {
    expect(parseVideoTitle('Nineteen Hollows - Paper Ladder (Official Music Video)')).toEqual({
      artist: 'Nineteen Hollows',
      title: 'Paper Ladder',
    });
  });

  it('keeps a bracket group that names something', () => {
    // Every word inside must be decoration for the group to go, so a credit survives.
    expect(parseVideoTitle('Nineteen Hollows – Paper Ladder (feat. Cold Arcade) [4K Remaster]')).toEqual({
      artist: 'Nineteen Hollows',
      title: 'Paper Ladder (feat. Cold Arcade)',
    });
  });

  it('reports a null artist rather than guessing when there is no separator', () => {
    expect(parseVideoTitle('Paper Ladder [Official Audio]')).toEqual({
      artist: null,
      title: 'Paper Ladder',
    });
  });

  it('keeps a hyphen that belongs to the title', () => {
    expect(parseVideoTitle('Nineteen Hollows - Paper - Ladder')).toEqual({
      artist: 'Nineteen Hollows',
      title: 'Paper - Ladder',
    });
  });
});

describe('pickTrackForVideo', () => {
  const video = { artist: 'Nineteen Hollows', title: 'Paper Ladder', durationSec: 200 };

  it('takes the cut whose length fits the video', () => {
    const picked = pickTrackForVideo(
      [track(1, 'Paper Ladder - Radio Edit', 160), track(2, 'Paper Ladder', 196)],
      video,
    );

    expect(picked?.lrclibId).toBe(2);
  });

  it('rejects a track that outlasts the video', () => {
    // An extended mix cannot be the thing playing: the words would run past the end.
    expect(pickTrackForVideo([track(1, 'Paper Ladder', 260)], video)).toBeNull();
  });

  it('rejects a different song that happened to come back from the search', () => {
    expect(pickTrackForVideo([track(1, 'Glass Harbour', 198)], video)).toBeNull();
  });

  it('matches across a remaster suffix', () => {
    const picked = pickTrackForVideo([track(1, 'Paper Ladder (Remastered)', 198)], video);
    expect(picked?.lrclibId).toBe(1);
  });

  it('prefers a measurable length over an entry with none', () => {
    const picked = pickTrackForVideo([track(1, 'Paper Ladder', null), track(2, 'Paper Ladder', 190)], video);
    expect(picked?.lrclibId).toBe(2);
  });

  it('falls back to an unknown length when nothing measurable fits', () => {
    const picked = pickTrackForVideo([track(1, 'Paper Ladder', null), track(2, 'Paper Ladder', 400)], video);
    expect(picked?.lrclibId).toBe(1);
  });
});
