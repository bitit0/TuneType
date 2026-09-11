import { Router } from 'express';
import { z } from 'zod';
import type { SetlistTier } from '@shared/types';
import { isAdmin, requireAdmin, requireAuth } from '../middleware/auth.js';
import { isFirestoreAvailable } from '../firestore.js';
import {
  addEntry,
  getEntry,
  listEntries,
  listLeaderboard,
  moveEntry,
  recordVerifiedScore,
  removeEntry,
  isSetlistTier,
  SetlistsUnavailableError,
} from '../setlists/store.js';
import { InvalidRunError, scoreVerifiedRun } from '../setlists/score.js';

/**
 * Curated setlists.
 *
 * Reading is open to everyone, including guests — the point of a curated list is that it is the
 * easiest way into the game, so putting it behind a sign-in would defeat it. Writing is admin
 * only, and there is no self-service path to becoming one: see `isAdmin`.
 */

export const setlistRouter = Router();

// Same shape as the avatar-colour check in the account schema: the union lives in shared types, the
// runtime list lives with the store, and this bridges them without duplicating either.
const tierSchema = z.custom<SetlistTier>(isSetlistTier, { message: 'Unknown difficulty tier.' });

/** Express 5 types a route param as possibly absent; a matched route always has one. */
const paramId = (req: import('express').Request): string => String(req.params.id ?? '');

/**
 * A curator's submission.
 *
 * The pace figures arrive from the browser because they are derived from lyrics, which the server
 * has never seen and never will. That means they are asserted rather than verified — the same
 * accepted consequence as saved runs. The bounds here exist to keep a broken client from writing
 * a number that renders as nonsense, not to establish trust.
 */
const submissionSchema = z.object({
  tier: tierSchema,
  lrclibId: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  album: z.string().max(300).nullable().default(null),
  videoId: z.string().trim().min(1).max(64),
  durationSec: z.number().positive().max(24 * 60 * 60).nullable().default(null),
  requiredWpm: z.number().nonnegative().max(1_000),
  peakWpm: z.number().nonnegative().max(2_000),
  lineCount: z.number().int().nonnegative().max(10_000),
  /*
   * Per-line lengths and windows, so runs on this entry can be scored here instead of being taken
   * on trust from whoever posts them. Numbers, not words — the same standing as the pace figures
   * above, and the reason a curated song can have a leaderboard when a searched one cannot.
   *
   * Optional so a client that predates it can still curate; an entry without one simply has no
   * leaderboard.
   */
  scoreProfile: z
    .array(
      z.object({
        len: z.number().int().nonnegative().max(2_000),
        startMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
        endMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
      }),
    )
    .max(10_000)
    .optional(),
});

/** How many rows a leaderboard returns. Enough to be a standings table, short enough to scan. */
const LEADERBOARD_LIMIT = 20;

/**
 * What a player reports after a run on a curated entry.
 *
 * There is no score field, deliberately. The client reports what it did and the server prices it;
 * see `setlists/score.ts` for what that does and does not establish.
 */
const verifiedRunSchema = z.object({
  offsetMs: z.number().int().min(-60_000).max(60_000),
  lines: z
    .array(
      z.object({
        i: z.number().int().nonnegative().max(10_000),
        correct: z.number().int().nonnegative().max(2_000),
        typed: z.number().int().nonnegative().max(2_000),
        doneAtMs: z.number().int().min(-60_000).max(24 * 60 * 60 * 1000).nullable(),
        // Bounded loosely because it cannot be checked against anything. It does not feed the
        // score — only the WPM shown beside it — so a silly value is cosmetic rather than ranking.
        typingMs: z.number().int().nonnegative().max(60 * 60 * 1000),
      }),
    )
    .min(1)
    .max(10_000),
});

setlistRouter.use((_req, res, next) => {
  if (!isFirestoreAvailable()) {
    res.status(503).json({ error: 'Setlists are not configured on this server.' });
    return;
  }
  next();
});

function handle(res: import('express').Response, error: unknown) {
  if (error instanceof SetlistsUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }
  console.error('[setlists]', error);
  res.status(500).json({ error: 'Something went wrong.' });
}

/**
 * The whole board in one read.
 *
 * `canCurate` travels with it so the client knows whether to offer the editing controls without a
 * second round trip — and so that whether someone is an admin is decided in exactly one place,
 * on the server, rather than inferred in the browser from an email address.
 */
setlistRouter.get('/', async (req, res) => {
  try {
    res.json({ entries: await listEntries(), canCurate: isAdmin(req.user) });
  } catch (error) {
    handle(res, error);
  }
});

setlistRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'That song could not be added.',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return;
  }

  try {
    res.status(201).json(await addEntry(parsed.data, req.user!.uid));
  } catch (error) {
    handle(res, error);
  }
});

setlistRouter.patch('/:id', requireAdmin, async (req, res) => {
  const parsed = z.object({ tier: tierSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Unknown tier.' });
    return;
  }

  try {
    await moveEntry(paramId(req), parsed.data.tier);
    res.status(204).end();
  } catch (error) {
    handle(res, error);
  }
});

setlistRouter.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await removeEntry(paramId(req));
    res.status(204).end();
  } catch (error) {
    handle(res, error);
  }
});

/**
 * The standings for one entry. Open to guests, like the rest of reading.
 *
 * A leaderboard nobody can see without an account would be a strange thing to put in front of the
 * people it is supposed to attract.
 */
setlistRouter.get('/:id/leaderboard', async (req, res) => {
  try {
    res.json({ rows: await listLeaderboard(paramId(req), LEADERBOARD_LIMIT) });
  } catch (error) {
    handle(res, error);
  }
});

/**
 * Posting a run on a curated entry.
 *
 * Signed in only, unlike play itself. A leaderboard row has to belong to somebody — an anonymous
 * one cannot be improved on, disputed, or recognised by the person who set it.
 */
setlistRouter.post('/:id/runs', requireAuth, async (req, res) => {
  const parsed = verifiedRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'That run could not be read.' });
    return;
  }

  try {
    const entry = await getEntry(paramId(req));
    if (!entry) {
      res.status(404).json({ error: 'No such setlist entry.' });
      return;
    }

    if (!entry.scoreProfile) {
      // Curated before verified scoring existed. Playable, but there is nothing to check a claim
      // against, so it gets no leaderboard rather than an unchecked one.
      res.status(409).json({ error: 'This entry was curated before scoring moved here. Re-add it to enable its leaderboard.' });
      return;
    }

    const score = scoreVerifiedRun(entry.scoreProfile, parsed.data.lines);
    const achievedAt = Date.now();

    const { improved, best } = await recordVerifiedScore(entry.id, req.user!.uid, {
      totalScore: score.totalScore,
      accuracy: score.accuracy,
      wpm: score.wpm,
      achievedAt,
    });

    res.json({ score, improved, best, rows: await listLeaderboard(entry.id, LEADERBOARD_LIMIT) });
  } catch (error) {
    if (error instanceof InvalidRunError) {
      // 422 rather than 400: the body was well-formed, its contents were impossible.
      res.status(422).json({ error: error.message });
      return;
    }
    handle(res, error);
  }
});
