import { z } from 'zod';
import type { AvatarColor } from '@shared/types';
import {
  DISPLAY_NAME_MAX,
  MAX_PHOTO_CHARS,
  isAvatarColor,
  isValidPhotoDataUri,
} from './stats.js';

/**
 * Request validation for the account routes.
 *
 * What this is: a check that a body is the right shape and inside sane bounds, so a malformed or
 * hostile request can't write nonsense that then poisons every lifetime average an account will
 * ever show.
 *
 * What this is NOT: anti-cheat. Scoring happens in the browser, against lyrics the server never
 * sees, so the server cannot recompute a run — it has nothing to recompute it from. Anyone willing
 * to open devtools can post a plausible-looking run. That is an accepted trade of the legal
 * posture (no lyrics server-side, ever), and it is fine for a personal project with per-user
 * history. It would not be fine for a public leaderboard, and that is the point at which scoring
 * would have to move somewhere the server can verify it.
 */

/** A run longer than this is a stuck clock, not a song. */
const MAX_RUN_MS = 2 * 60 * 60 * 1000;

/** Comfortably past the world record; anything beyond is a broken client or a fabrication. */
const MAX_CHARS = 100_000;

export const runSubmissionSchema = z
  .object({
    lrclibId: z.number().int().nonnegative(),
    title: z.string().min(1).max(300),
    artist: z.string().min(1).max(300),
    album: z.string().max(300).nullable().default(null),
    videoId: z.string().min(1).max(64),
    totalScore: z.number().int().nonnegative().max(10_000_000),
    correctChars: z.number().int().nonnegative().max(MAX_CHARS),
    typedChars: z.number().int().nonnegative().max(MAX_CHARS),
    linesAttempted: z.number().int().nonnegative().max(10_000),
    linesCompleted: z.number().int().nonnegative().max(10_000),
    typingMs: z.number().int().nonnegative().max(MAX_RUN_MS),
    elapsedMs: z.number().int().nonnegative().max(MAX_RUN_MS),
    offsetMs: z.number().int().min(-60_000).max(60_000),
    // Not an integer: a song's required pace is a real number and rounding it to a whole word per
    // minute would quietly change the comparison it exists to support. Absent on runs saved before
    // this field existed, which is why it defaults rather than failing them.
    requiredWpm: z.number().nonnegative().max(1_000).default(0),
  })
  // Cross-field checks. Each of these is individually plausible and jointly impossible, which is
  // exactly the kind of corruption that survives per-field validation and then quietly makes an
  // account's lifetime accuracy exceed 100%.
  .refine((run) => run.correctChars <= run.typedChars, {
    message: 'correctChars cannot exceed typedChars',
    path: ['correctChars'],
  })
  .refine((run) => run.linesCompleted <= run.linesAttempted, {
    message: 'linesCompleted cannot exceed linesAttempted',
    path: ['linesCompleted'],
  });

// Deliberately NOT checked: `typingMs <= elapsedMs`. It holds for an ordinary run — per-line
// intervals are disjoint slices of the run's span — but seeking backwards in the video makes an
// earlier line active again, and time typed there is counted inside a span that has already moved
// past it. Enforcing the relationship would reject a real run for using the seek bar, and losing
// someone's score is a worse outcome than an odd-looking pair of numbers.

/**
 * A profile patch. Every field is optional and only what is present gets written, so the picture
 * editor and the rename form can share one endpoint without either clobbering the other's field.
 *
 * `photo` accepts null explicitly — that is how "remove my picture" is expressed, and it has to be
 * distinguishable from the field simply being absent.
 */
export const profileUpdateSchema = z
  .object({
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX * 4).optional(),
    photo: z
      .string()
      .max(MAX_PHOTO_CHARS)
      .refine(isValidPhotoDataUri, {
        message: 'Picture must be a base64 PNG, JPEG or WebP data URI.',
      })
      .nullable()
      .optional(),
    avatarColor: z.custom<AvatarColor>(isAvatarColor, { message: 'Unknown avatar color.' }).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Nothing to update.',
  });

export const runQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
