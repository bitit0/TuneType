import { Router } from 'express';
import { z } from 'zod';
import type { SetlistTier } from '@shared/types';
import { isAdmin, requireAdmin } from '../middleware/auth.js';
import { isFirestoreAvailable } from '../firestore.js';
import {
  addEntry,
  listEntries,
  moveEntry,
  removeEntry,
  isSetlistTier,
  SetlistsUnavailableError,
} from '../setlists/store.js';

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
