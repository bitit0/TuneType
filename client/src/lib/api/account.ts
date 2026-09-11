import type {
  AccountOverview,
  Keystroke,
  AccountStats,
  PlayableTrack,
  ProfilePatch,
  RunSubmission,
  RunSummary,
  SavedRun,
  UserProfile,
} from '@shared/types';
import { apiFetch } from './client';
import { analyzeDifficulty } from '@/lib/scoring/difficulty';
import { tallyKeys } from '@/lib/scoring/keys';

/** Typed calls against /api/account. Every one of them requires a signed-in user. */

export function fetchOverview(signal?: AbortSignal): Promise<AccountOverview> {
  return apiFetch<AccountOverview>('/api/account/me', { auth: true, signal });
}

/** Partial update — send only the fields being changed. `photo: null` removes the picture. */
export function updateProfile(patch: ProfilePatch): Promise<UserProfile> {
  return apiFetch<UserProfile>('/api/account/me', {
    method: 'PATCH',
    body: patch,
    auth: true,
  });
}

export function postRun(run: RunSubmission): Promise<{ run: SavedRun; stats: AccountStats }> {
  return apiFetch('/api/account/runs', { method: 'POST', body: run, auth: true });
}

export function deleteAccount(): Promise<void> {
  return apiFetch<void>('/api/account', { method: 'DELETE', auth: true });
}

/**
 * Reduces a finished run to what may be persisted.
 *
 * This function is the enforcement point for the project's legal posture, so read it before adding
 * a field. `summary.lines` is dropped entirely and the track's `lines` are never touched: the
 * lyrics and the player's typing stay in memory for the length of the run and go no further. What
 * survives is track metadata and counts.
 *
 * Integer coercion is not cosmetic — the server's schema rejects non-integers, and `wpm` and
 * `accuracy` are deliberately not sent at all. The server recomputes both from the counts, so
 * there is exactly one definition of each in the stored data.
 */
export function toRunSubmission(
  track: PlayableTrack,
  videoId: string,
  offsetMs: number,
  summary: RunSummary,
  keystrokes: Keystroke[],
): RunSubmission {
  let correctChars = 0;
  let typedChars = 0;
  for (const line of summary.lines) {
    correctChars += line.correctChars;
    typedChars += line.typedChars;
  }

  return {
    lrclibId: track.lrclibId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    videoId,
    totalScore: Math.round(summary.totalScore),
    correctChars,
    typedChars,
    linesAttempted: summary.linesAttempted,
    linesCompleted: summary.linesCompleted,
    typingMs: Math.round(summary.typingMs),
    elapsedMs: Math.round(summary.elapsedMs),
    offsetMs: Math.round(offsetMs),
    // Derived from the LRC timings, which the server never sees — so it has to travel with the
    // run. An aggregate pace, not content: see the field's note in shared/src/types.ts.
    requiredWpm: Number(analyzeDifficulty(track.lines).requiredWpm.toFixed(2)),
    // Counts per key, with the order stripped out — the only thing derived from what was typed
    // that may leave the browser. The server adds it to a lifetime total and keeps nothing
    // track-specific: see the field's note in shared/src/types.ts.
    keyTally: tallyKeys(keystrokes),
  };
}
