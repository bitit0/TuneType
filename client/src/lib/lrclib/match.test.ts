import { describe, expect, it } from 'vitest';
import type { LrcTimeMs, LyricLine, PlayableTrack } from '@shared/types';
import { artistFromChannel, parseVideoTitle, pickTrackForVideo } from './match';

/**
 * Fixtures are synthetic — invented artists, invented songs. Nothing in this repo is lyrics
 * content, and a test file is not an exception to that.
 */

const LINES: LyricLine[] = [{ startMs: 0 as LrcTimeMs, endMs: 1_000 as LrcTimeMs, text: 'aaa' }];

function track(
  id: number,
  title: string,
  durationSec: number | null,
  artist = 'Nineteen Hollows',
): PlayableTrack {
  return { lrclibId: id, title, artist, album: null, durationSec, lines: LINES };
}

describe('artistFromChannel', () => {
  it('reads the artist off an auto-generated Topic channel', () => {
    expect(artistFromChannel('Nineteen Hollows - Topic')).toBe('Nineteen Hollows');
  });

  it('handles the dashes YouTube actually uses', () => {
    expect(artistFromChannel('Nineteen Hollows – Topic')).toBe('Nineteen Hollows');
  });

  it('strips a VEVO suffix', () => {
    expect(artistFromChannel('NineteenHollowsVEVO')).toBe('NineteenHollows');
  });

  it('leaves an ordinary channel name alone', () => {
    expect(artistFromChannel('Nineteen Hollows')).toBe('Nineteen Hollows');
  });
});

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

describe('pickTrackForVideo, without a usable title', () => {
  /*
   * The regression this file exists for.
   *
   * A Topic upload is titled with the song alone — its artist is the channel — so reading only the
   * title left a one-word search. "Dreams" then matched an unrelated band's song whose LRCLIB
   * record happened to carry the word in its track name, and the duration agreed to within a
   * second, so it was picked confidently. Both halves of that are covered here.
   */
  it('refuses to identify a song from one common word and no artist', () => {
    const tracks = [track(1, 'Victima', 257, "Carla's Dreams")];
    expect(pickTrackForVideo(tracks, { artist: null, title: 'Dreams', durationSec: 258 })).toBeNull();
  });

  it('rejects another artist whose track name merely contains the word', () => {
    // LRCLIB records routinely bury the artist in the track name, which is why this one scores a
    // perfect title overlap against a single wanted word. The artist check is what stops it.
    const tracks = [track(1, "Carla's Dreams - Victima | Official Video", 257, "Carla's Dreams")];

    expect(
      pickTrackForVideo(tracks, { artist: 'Fleetwood Mac', title: 'Dreams', durationSec: 258 }),
    ).toBeNull();
  });

  it('accepts the right artist even when their name is buried in the track name', () => {
    const tracks = [track(1, 'Fleetwood Mac - Dreams', 258, 'Fleetwood Mac')];

    expect(
      pickTrackForVideo(tracks, { artist: 'Fleetwood Mac', title: 'Dreams', durationSec: 258 })
        ?.lrclibId,
    ).toBe(1);
  });

  it('still matches when billing differs between the two sides', () => {
    // Half the artist's words is enough: one side credits the band, the other the frontman too.
    const tracks = [track(1, 'Refugee', 200, 'Tom Petty and the Heartbreakers')];

    expect(
      pickTrackForVideo(tracks, { artist: 'Tom Petty', title: 'Refugee', durationSec: 202 })
        ?.lrclibId,
    ).toBe(1);
  });

  it('allows a multi-word title with no artist, which is identifying enough', () => {
    const tracks = [track(1, 'Paper Ladder', 196)];

    expect(
      pickTrackForVideo(tracks, { artist: null, title: 'Paper Ladder', durationSec: 200 })?.lrclibId,
    ).toBe(1);
  });
});
