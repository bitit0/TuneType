import type { LrclibTrack, PlayableTrack } from '@shared/types';
import { parseLrc } from './parseLrc';

/**
 * LRCLIB client, called directly from the browser.
 *
 * Deliberately not proxied through our server: keeping the request in the user's browser is the
 * strongest guarantee that lyrics never touch our infrastructure, so no cache can form by
 * accident. See the legal posture in PROJECT_CONTEXT.md.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';

export class LrclibError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LrclibError';
  }
}

/**
 * Free-text search. LRCLIB's `q` covers title and artist together, so searching by title alone
 * works and adding the artist just narrows it.
 */
export async function searchTracks(query: string, signal?: AbortSignal): Promise<LrclibTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${LRCLIB_BASE}/search?q=${encodeURIComponent(trimmed)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // A CORS rejection surfaces here as an opaque TypeError, so name it as a likely cause.
    throw new LrclibError(
      'Could not reach LRCLIB. Check your connection — if this persists it may be a CORS restriction.',
      error,
    );
  }

  if (!response.ok) {
    throw new LrclibError(`LRCLIB search failed (HTTP ${response.status}).`);
  }

  return (await response.json()) as LrclibTrack[];
}

/**
 * Fetches one track by its LRCLIB id.
 *
 * What the setlists page runs on: a curated entry stores the id, not the lyrics, so the words are
 * fetched from LRCLIB in the browser at the moment someone presses play — exactly as they are for
 * a searched track. A curated list is a list of pointers, and this is what follows one.
 */
export async function fetchTrackById(
  lrclibId: number,
  signal?: AbortSignal,
): Promise<PlayableTrack | null> {
  let response: Response;
  try {
    response = await fetch(`${LRCLIB_BASE}/get/${lrclibId}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LrclibError('Could not reach LRCLIB to load this song.', error);
  }

  // A curated entry can outlive the LRCLIB record it points at — entries do get merged or removed
  // upstream. That is a missing song, not a broken page, and the caller says so.
  if (response.status === 404) return null;
  if (!response.ok) throw new LrclibError(`LRCLIB lookup failed (HTTP ${response.status}).`);

  return toPlayableTrack((await response.json()) as LrclibTrack);
}

/**
 * Whether a result can actually be played: it needs synced lyrics that parse into at least one
 * line. Plain-text-only and instrumental results are filtered out of the picker rather than
 * offered and then failing at play time.
 */
export function toPlayableTrack(track: LrclibTrack): PlayableTrack | null {
  if (track.instrumental || !track.syncedLyrics) return null;

  const lines = parseLrc(track.syncedLyrics);
  if (lines.length === 0) return null;

  return {
    lrclibId: track.id,
    title: track.trackName,
    artist: track.artistName,
    album: track.albumName,
    durationSec: track.duration,
    lines,
  };
}

/**
 * Search, keeping only results that can be played.
 *
 * An empty array here is a normal state — plenty of tracks have no synced lyrics on LRCLIB — and
 * the UI treats it as such rather than as an error.
 */
export async function searchPlayableTracks(
  query: string,
  signal?: AbortSignal,
): Promise<PlayableTrack[]> {
  const results = await searchTracks(query, signal);
  return results
    .map(toPlayableTrack)
    .filter((track): track is PlayableTrack => track !== null);
}
