import type { PlayableTrack } from '@shared/types';
import { searchPlayableTracks } from './client';

/**
 * Matching a video to its lyrics — the search direction reversed.
 *
 * `server/src/youtube/rank.ts` starts from a canonical LRCLIB track and treats the video as the
 * thing under suspicion. This module runs the other way: the video is what the user picked, and
 * the LRCLIB entry is what has to be identified. Same problem, opposite unknown, so the heuristics
 * are the mirror image — a title read off an upload rather than a database, and a duration that is
 * expected to be a little long rather than an exact figure.
 */

/**
 * Bracketed words that decorate a title rather than name anything in it.
 *
 * A group is stripped only when *every* word in it is decoration, which is what keeps
 * "(Official Video)" out and "(feat. Someone)" in. Years count, because "(Remastered 2011)" is
 * one phrase and dropping half of it would leave a stray number in the query.
 */
const DECORATION =
  /^(official|full|hd|hq|4k|8k|uhd|audio|video|visuali[sz]er|lyric|lyrics|mv|music|explicit|clean|remaster|remastered|version|clip|\d{4})$/;

/** Separators an upload uses between artist and title, in the order they are tried. */
const SEPARATOR = /\s+[-–—|]\s+/;

function tokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Share of the shorter title's words that both titles carry, 0-1.
 *
 * Measured against the shorter of the two on purpose. "Bohemian Rhapsody" and "Bohemian Rhapsody
 * (Remastered 2011)" are the same song, and a denominator that counted the longer title's extra
 * words would score them as half a match.
 */
function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const other = new Set(b);
  const shared = a.filter((token) => other.has(token)).length;
  return shared / Math.min(a.length, b.length);
}

/** Below this share of shared words it is a different song, not a different cut of one. */
const MIN_TITLE_OVERLAP = 0.6;

/**
 * How much longer than the track a video may run.
 *
 * A video is normally the long one — a title card, a spoken intro, an outro held past the last
 * word. Past half a minute it is something else: an extended mix, or a track followed by the next
 * one.
 */
const MAX_EXCESS_SEC = 30;

/**
 * How much shorter a video may be. Rounding only.
 *
 * Same asymmetry, and the same reasoning, as the shortfall grace in the server's ranking: a video
 * that ends before the lyrics do is a radio edit or a different recording, and no amount of timing
 * correction makes its words line up.
 */
const MAX_SHORTFALL_SEC = 3;

export interface ParsedVideoTitle {
  /** Null when the upload gave no separator to split on. */
  artist: string | null;
  title: string;
}

/**
 * Pulls an artist and a title out of a YouTube video title.
 *
 * Best-effort, and it says so by returning a null artist rather than guessing: LRCLIB's free-text
 * search covers artist and title together, so a title that could not be split still searches, it
 * just searches less precisely.
 */
export function parseVideoTitle(videoTitle: string): ParsedVideoTitle {
  const stripped = videoTitle
    .replace(/[([{]([^)\]}]*)[)\]}]/g, (whole, inner: string) => {
      const words = tokens(inner);
      return words.length > 0 && words.every((word) => DECORATION.test(word)) ? ' ' : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();

  const parts = stripped.split(SEPARATOR);
  if (parts.length < 2) return { artist: null, title: stripped.replace(/^["']|["']$/g, '') };

  return { artist: (parts[0] ?? '').trim(), title: parts.slice(1).join(' - ').trim() };
}

/**
 * The LRCLIB entry that matches a video, or null when none of them do.
 *
 * Title decides whether an entry is the same song; duration decides which cut of it. That split is
 * what makes the pick defensible — one recording is routinely several LRCLIB entries with near
 * identical titles, and length is the only thing that tells the album version from the edit.
 *
 * Entries LRCLIB gave no duration for can still win, but only once everything measurable has been
 * ruled out. An unknown length cannot be checked against the video, and a guess that cannot be
 * checked should not beat one that can.
 */
export function pickTrackForVideo(
  tracks: PlayableTrack[],
  video: { artist: string | null; title: string; durationSec: number },
): PlayableTrack | null {
  const wanted = tokens(video.title);

  const scored = tracks
    .filter((track) => overlap(tokens(track.title), wanted) >= MIN_TITLE_OVERLAP)
    .map((track) => ({
      track,
      // Positive means the video runs longer than the track, which is the normal direction.
      excessSec: track.durationSec === null ? null : video.durationSec - track.durationSec,
    }))
    .filter(
      ({ excessSec }) =>
        excessSec === null || (excessSec <= MAX_EXCESS_SEC && excessSec >= -MAX_SHORTFALL_SEC),
    )
    .sort((a, b) => {
      if (a.excessSec === null || b.excessSec === null) {
        return Number(a.excessSec === null) - Number(b.excessSec === null);
      }
      return Math.abs(a.excessSec) - Math.abs(b.excessSec);
    });

  return scored[0]?.track ?? null;
}

/**
 * Everything between picking a video and having something to type: read the title, ask LRCLIB,
 * choose an entry.
 *
 * Stays in the browser, like every other lyrics call. Null is an ordinary answer — plenty of
 * videos have no synced lyrics anywhere — and the caller offers the manual search instead.
 */
export async function resolveTrackForVideo(
  video: { title: string; durationSec: number },
  signal?: AbortSignal,
): Promise<PlayableTrack | null> {
  const parsed = parseVideoTitle(video.title);
  const query = parsed.artist ? `${parsed.artist} ${parsed.title}` : parsed.title;

  const tracks = await searchPlayableTracks(query, signal);
  return pickTrackForVideo(tracks, { ...parsed, durationSec: video.durationSec });
}
