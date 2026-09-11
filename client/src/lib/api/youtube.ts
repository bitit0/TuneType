import type { PlayableTrack, VideoSearchResponse } from '@shared/types';
import { apiFetch, ApiError } from './client';

/**
 * Typed calls against /api/youtube.
 *
 * Unauthenticated on purpose — choosing a video is part of starting a song, and guest play stays
 * the default. The API key lives on the server, which is the only reason these go through our own
 * API rather than straight to Google the way the LRCLIB calls do.
 */

/**
 * Ranked videos for a track.
 *
 * `cachedOnly` is what the video screen opens with: it answers instantly for a track someone has
 * already looked up, and reports `needsSearch` for one nobody has, without spending any of the
 * day's hundred searches on a screen the user may just be passing through.
 */
export function searchVideos(
  track: PlayableTrack,
  options: { cachedOnly?: boolean; signal?: AbortSignal } = {},
): Promise<VideoSearchResponse> {
  const params = new URLSearchParams({ title: track.title, artist: track.artist });
  if (track.durationSec !== null) params.set('durationSec', String(track.durationSec));
  if (options.cachedOnly) params.set('cachedOnly', 'true');
  // Lets the server fold in what players have measured about these videos for this exact track —
  // a confirmed timing promotes a candidate, and irreconcilable ones demote it.
  params.set('lrclibId', String(track.lrclibId));

  return apiFetch<VideoSearchResponse>(`/api/youtube/search?${params}`, { signal: options.signal });
}

/**
 * True when the search budget for the day is gone.
 *
 * Distinguished from a plain failure because the two need different words: this one is temporary,
 * it is nobody's mistake, and the paste form still works.
 */
export function isQuotaExceeded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}
