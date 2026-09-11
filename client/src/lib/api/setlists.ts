import type { PlayableTrack, SetlistEntry, SetlistSubmission, SetlistTier } from '@shared/types';
import { analyzeDifficulty } from '@/lib/scoring/difficulty';
import { apiFetch } from './client';

/**
 * Typed calls against /api/setlists.
 *
 * Sent with auth even for the read, because the same response carries `canCurate` — whether
 * someone may edit is decided by the server from the verified token, never inferred in the browser
 * from an email address.
 */

export function fetchSetlists(
  signal?: AbortSignal,
): Promise<{ entries: SetlistEntry[]; canCurate: boolean }> {
  return apiFetch('/api/setlists', { auth: true, signal });
}

/**
 * Reduces a track to a curated entry.
 *
 * The counterpart of `toRunSubmission`, and governed by the same rule: read it before adding a
 * field. The lyrics are used here — to count lines and measure pace — and then discarded. What
 * leaves the browser is metadata and three numbers.
 */
export function toSetlistSubmission(
  track: PlayableTrack,
  videoId: string,
  tier: SetlistTier,
): SetlistSubmission {
  const difficulty = analyzeDifficulty(track.lines);

  return {
    tier,
    lrclibId: track.lrclibId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    videoId,
    durationSec: track.durationSec,
    requiredWpm: Number(difficulty.requiredWpm.toFixed(2)),
    peakWpm: Number(difficulty.peakWpm.toFixed(2)),
    lineCount: difficulty.lineCount,
  };
}

export function addToSetlist(submission: SetlistSubmission): Promise<SetlistEntry> {
  return apiFetch<SetlistEntry>('/api/setlists', {
    method: 'POST',
    body: submission,
    auth: true,
  });
}

export function moveInSetlist(id: string, tier: SetlistTier): Promise<void> {
  return apiFetch<void>(`/api/setlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { tier },
    auth: true,
  });
}

export function removeFromSetlist(id: string): Promise<void> {
  return apiFetch<void>(`/api/setlists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

/**
 * YouTube's thumbnail for a video.
 *
 * Served straight from `i.ytimg.com`, which needs no API key and costs no quota — the search quota
 * is the scarcest thing this app has, and spending it to render a picture would be absurd.
 * `mqdefault` exists for every video; the larger sizes do not, and a missing one renders as a grey
 * placeholder rather than as an error.
 */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}
