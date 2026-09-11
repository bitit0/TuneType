import type {
  AccountStats,
  AvatarColor,
  KeyTally,
  RunSubmission,
  StatAccumulators,
  TrackBest,
} from '@shared/types';

/**
 * Pure account arithmetic. No Firestore, no Express — everything here is a function of its
 * arguments, which is what makes the rules below testable without a cloud project.
 */

/**
 * Duplicated from `client/src/lib/scoring/constants.ts` rather than imported.
 *
 * `shared/` is deliberately type-only — nothing in it survives compilation, so neither runtime has
 * to resolve the `@shared` alias — and promoting a constant into it would end that property for
 * one number. The two copies must agree: a run's WPM on the results screen and the same run's WPM
 * in history are the same claim, and users will notice if they differ.
 */
const CHARS_PER_WORD = 5;

/** Longest a display name may be. Long enough for a real handle, short enough not to break rows. */
export const DISPLAY_NAME_MAX = 24;
export const DISPLAY_NAME_MIN = 2;

export function emptyAccumulators(): StatAccumulators {
  return {
    runs: 0,
    totalScore: 0,
    bestScore: 0,
    bestWpm: 0,
    correctChars: 0,
    typedChars: 0,
    linesAttempted: 0,
    linesCompleted: 0,
    totalTypingMs: 0,
    keyTally: {},
  };
}

/**
 * Adds one run's key counts into a lifetime tally.
 *
 * Returns a new object rather than mutating, like every other accumulator here, because the result
 * is written inside a Firestore transaction that may be retried — folding a run into the totals
 * twice would be invisible and permanent.
 */
export function mergeKeyTally(lifetime: KeyTally, run: KeyTally): KeyTally {
  const merged: KeyTally = {};

  for (const [key, entry] of Object.entries(lifetime)) {
    merged[key] = { attempts: entry.attempts, misses: entry.misses };
  }

  for (const [key, entry] of Object.entries(run)) {
    const existing = merged[key];
    merged[key] = existing
      ? { attempts: existing.attempts + entry.attempts, misses: existing.misses + entry.misses }
      : { attempts: entry.attempts, misses: entry.misses };
  }

  return merged;
}

/**
 * Accuracy and speed from raw counts.
 *
 * Kept in one place because it is applied at two scales — a single run and a lifetime — and the
 * lifetime figure is only meaningful if it uses the identical formula over summed counts.
 */
export function deriveMetrics(
  correctChars: number,
  typedChars: number,
  typingMs: number,
): { accuracy: number; wpm: number } {
  const minutes = typingMs / 60_000;
  return {
    accuracy: typedChars === 0 ? 0 : correctChars / typedChars,
    wpm: minutes <= 0 ? 0 : correctChars / CHARS_PER_WORD / minutes,
  };
}

/** Expands stored accumulators into the shape the client renders. */
export function toAccountStats(accumulators: StatAccumulators): AccountStats {
  const { accuracy, wpm } = deriveMetrics(
    accumulators.correctChars,
    accumulators.typedChars,
    accumulators.totalTypingMs,
  );
  return { ...accumulators, accuracy, wpm };
}

/**
 * Folds one finished run into an account's running totals.
 *
 * Lifetime accuracy is computed from summed characters, not by averaging each run's accuracy: a
 * two-character run and a nine-hundred-character run are not equally strong evidence of how
 * accurately someone types, and averaging percentages would treat them as if they were.
 */
export function applyRun(
  accumulators: StatAccumulators,
  run: RunSubmission,
  runWpm: number,
): StatAccumulators {
  return {
    runs: accumulators.runs + 1,
    totalScore: accumulators.totalScore + run.totalScore,
    bestScore: Math.max(accumulators.bestScore, run.totalScore),
    bestWpm: Math.max(accumulators.bestWpm, runWpm),
    correctChars: accumulators.correctChars + run.correctChars,
    typedChars: accumulators.typedChars + run.typedChars,
    linesAttempted: accumulators.linesAttempted + run.linesAttempted,
    linesCompleted: accumulators.linesCompleted + run.linesCompleted,
    totalTypingMs: accumulators.totalTypingMs + run.typingMs,
    keyTally: mergeKeyTally(accumulators.keyTally, run.keyTally),
  };
}

/**
 * Updates the personal best for one track.
 *
 * Each dimension keeps its own maximum rather than all three coming from whichever run scored
 * highest. A run can be the fastest without being the most accurate, and hiding that behind a
 * single "best run" would throw away the more interesting half of someone's history.
 */
export function applyTrackBest(
  existing: TrackBest | null,
  run: RunSubmission,
  metrics: { accuracy: number; wpm: number },
  playedAt: number,
): TrackBest {
  return {
    lrclibId: run.lrclibId,
    // Metadata is refreshed from the latest run: LRCLIB entries do get corrected upstream.
    title: run.title,
    artist: run.artist,
    bestScore: Math.max(existing?.bestScore ?? 0, run.totalScore),
    bestWpm: Math.max(existing?.bestWpm ?? 0, metrics.wpm),
    bestAccuracy: Math.max(existing?.bestAccuracy ?? 0, metrics.accuracy),
    plays: (existing?.plays ?? 0) + 1,
    lastPlayedAt: playedAt,
  };
}

/**
 * Cleans a user-supplied display name, or returns null if it can't be salvaged.
 *
 * Control characters are stripped rather than rejected — they arrive from paste, not from intent —
 * but a name that is only whitespace or only invisible characters is a rejection, since accepting
 * it would render as a blank account throughout the UI.
 */
export function normalizeDisplayName(raw: string): string | null {
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  // Collapse internal runs of whitespace so names can't be padded out to fake alignment.
  const collapsed = stripped.replace(/\s+/g, ' ').trim();

  if (collapsed.length < DISPLAY_NAME_MIN) return null;
  return collapsed.slice(0, DISPLAY_NAME_MAX);
}

/**
 * The name a brand-new account starts with.
 *
 * Google sign-in supplies a real name; email sign-up supplies nothing, so the email local-part
 * stands in. Falling back to a slice of the uid guarantees a non-empty name in every case, which
 * is what lets the rest of the app treat `displayName` as always present.
 */
export function defaultDisplayName(
  providerName: string | null,
  email: string | null,
  uid: string,
): string {
  const candidates = [providerName, email?.split('@')[0] ?? null];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeDisplayName(candidate);
    if (normalized) return normalized;
  }
  return `player-${uid.slice(0, 6)}`;
}

// --- Avatars --------------------------------------------------------------------------------

/**
 * The palette, as a value. Typed against the shared union so adding a color there is a compile
 * error here until this list catches up.
 */
export const AVATAR_COLORS = [
  'blue',
  'violet',
  'teal',
  'amber',
  'rose',
  'lime',
  'slate',
] as const satisfies readonly AvatarColor[];

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === 'string' && (AVATAR_COLORS as readonly string[]).includes(value);
}

/**
 * Picks a starting color for a new account.
 *
 * Derived from the uid rather than random so it is stable: re-provisioning a profile, or reading
 * one written before this field existed, lands on the same color instead of silently changing the
 * avatar someone has got used to.
 */
export function defaultAvatarColor(uid: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    // Cheap string hash; collisions across a 7-color palette are the point, not a problem.
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/**
 * Largest stored picture, in characters of data URI.
 *
 * The client downscales to a small square before sending, so a legitimate upload lands far below
 * this; the cap exists to stop a hand-rolled request from parking hundreds of kilobytes in a
 * document that is read on every page load. Firestore's own limit is 1MB per document, which is
 * the wrong ceiling to design against — the profile has to stay cheap to fetch.
 */
export const MAX_PHOTO_CHARS = 48_000;

/** Formats the client is allowed to send. SVG is absent deliberately — see `isValidPhotoDataUri`. */
const ALLOWED_PHOTO_MIME = ['image/webp', 'image/png', 'image/jpeg'] as const;

/**
 * Whether a string is a picture we are willing to store and later render in an `<img>`.
 *
 * The mime allowlist is the security-relevant part. `image/svg+xml` is excluded because an SVG is
 * a document, not a bitmap: it can carry script and, rendered from a same-origin data URI, that
 * script would run with the page's privileges. The three raster formats here cannot execute
 * anything. Everything is re-encoded by the browser's canvas before upload, so a real client never
 * needs a format outside this list — but the check has to live here, because a hostile client
 * simply won't run that code.
 */
export function isValidPhotoDataUri(value: string): boolean {
  if (value.length > MAX_PHOTO_CHARS) return false;

  const match = /^data:([a-z+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;

  const [, mime, payload] = match;
  if (!(ALLOWED_PHOTO_MIME as readonly string[]).includes(mime!)) return false;

  // Base64 encodes 3 bytes per 4 characters; a length that isn't a multiple of 4 is malformed.
  return payload!.length % 4 === 0;
}
