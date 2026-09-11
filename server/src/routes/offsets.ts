import { Router } from 'express';
import { z } from 'zod';
import { isFirestoreAvailable } from '../firestore.js';
import { getConsensus, MAX_OFFSET_MS, OffsetsUnavailableError, submitOffset } from '../offsets/store.js';

/**
 * The offset store's HTTP surface.
 *
 * Open to guests, deliberately. Requiring an account to calibrate would make the store's coverage
 * depend on how many people sign up, and coverage is the entire value of the thing — one person
 * measuring a video correctly is supposed to fix it for everyone who plays it afterwards.
 * `optionalAuth` has already run, so a signed-in submission is attributed and can be deduplicated;
 * a guest's is counted anonymously and the median absorbs the extra noise.
 *
 * Like the account routes, nothing here may become a prerequisite for playing: without Firestore
 * these answer 503 and the client falls back to arrow-key nudging, which is how it worked before
 * any of this existed.
 */

export const offsetRouter = Router();

const pairSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  lrclibId: z.coerce.number().int().nonnegative(),
});

const submissionSchema = pairSchema.extend({
  /**
   * Bounded to what a person could plausibly have measured. A title card runs to a few seconds;
   * a minute means someone calibrated against the wrong part of the song, and letting that in
   * would drag the spread far enough to mark a good video contested.
   */
  offsetMs: z.number().int().min(-MAX_OFFSET_MS).max(MAX_OFFSET_MS),
  source: z.enum(['tap', 'nudge']),
});

offsetRouter.use((_req, res, next) => {
  if (!isFirestoreAvailable()) {
    res.status(503).json({ error: 'Offset sharing is not configured on this server.' });
    return;
  }
  next();
});

function handle(res: import('express').Response, error: unknown) {
  if (error instanceof OffsetsUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }
  console.error('[offsets]', error);
  res.status(500).json({ error: 'Something went wrong.' });
}

offsetRouter.get('/:videoId/:lrclibId', async (req, res) => {
  const parsed = pairSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'A video id and track id are required.' });
    return;
  }

  try {
    res.json(await getConsensus(parsed.data.videoId, parsed.data.lrclibId));
  } catch (error) {
    handle(res, error);
  }
});

offsetRouter.post('/', async (req, res) => {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'That timing could not be saved.',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return;
  }

  try {
    const consensus = await submitOffset({
      ...parsed.data,
      // Attribution when it is available, anonymity when it is not. Neither path is privileged in
      // the consensus itself — a signed-in submission counts exactly as much as a guest's.
      uid: req.user?.uid ?? null,
    });
    res.status(201).json(consensus);
  } catch (error) {
    handle(res, error);
  }
});
