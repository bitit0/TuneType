import type {
  LeaderboardRow,
  LineSpec,
  PlayableTrack,
  RunSummary,
  SetlistEntry,
  SetlistSubmission,
  SetlistTier,
  VerifiedRunSubmission,
} from '@shared/types';
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
 * field. The lyrics are used here — to count lines, measure pace and record each line's length and
 * window — and then discarded. What leaves the browser is metadata and numbers.
 *
 * `scoreProfile` is the newest of those and the one worth pausing on. It is how a curated song gets
 * a leaderboard: with each line's length and window stored, the server can price a run itself
 * instead of believing a score the browser posts. It carries no words and no order beyond the one
 * the timings already imply, so it sits inside the same rule as `requiredWpm`, which is an
 * aggregate over exactly the same lyrics.
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
    scoreProfile: track.lines.map(
      (line): LineSpec => ({
        len: line.text.length,
        startMs: Math.round(line.startMs),
        endMs: Math.round(line.endMs),
      }),
    ),
  };
}

/**
 * Reduces a finished run to what the server needs to score it.
 *
 * Note what is missing: the score. The client reports per-line counts and timings, and the server
 * works out what they are worth against the entry's stored profile. That is the whole point — two
 * players' standings are then computed by one implementation rather than by whatever each browser
 * ran.
 *
 * Lines the player never touched are dropped rather than sent as zeroes. An untyped line scores
 * nothing either way, and sending them would pad every submission with the length of the song.
 */
export function toVerifiedRunSubmission(
  entryId: string,
  offsetMs: number,
  summary: RunSummary,
): VerifiedRunSubmission {
  return {
    entryId,
    offsetMs: Math.round(offsetMs),
    lines: summary.lines.map((line) => ({
      i: line.lineIndex,
      correct: line.correctChars,
      typed: line.typedChars,
      doneAtMs: line.completedAtMs === null ? null : Math.round(line.completedAtMs),
      typingMs: Math.round(line.typingMs),
    })),
  };
}

export function fetchLeaderboard(
  entryId: string,
  signal?: AbortSignal,
): Promise<{ rows: LeaderboardRow[] }> {
  return apiFetch(`/api/setlists/${encodeURIComponent(entryId)}/leaderboard`, { signal });
}

export interface VerifiedRunResult {
  score: { totalScore: number; accuracy: number; wpm: number };
  improved: boolean;
  rows: LeaderboardRow[];
}

export function postVerifiedRun(submission: VerifiedRunSubmission): Promise<VerifiedRunResult> {
  return apiFetch<VerifiedRunResult>(
    `/api/setlists/${encodeURIComponent(submission.entryId)}/runs`,
    { method: 'POST', body: submission, auth: true },
  );
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
