import { Router, type Request, type Response } from 'express';
import type { ProfilePatch } from '@shared/types';
import { requireAuth } from '../middleware/auth.js';
import { isFirestoreAvailable } from '../firestore.js';
import { profileUpdateSchema, runQuerySchema, runSubmissionSchema } from '../accounts/schema.js';
import { normalizeDisplayName, DISPLAY_NAME_MIN, DISPLAY_NAME_MAX } from '../accounts/stats.js';
import {
  AccountsUnavailableError,
  deleteAccount,
  getOverview,
  listRuns,
  saveRun,
  updateProfile,
  type Identity,
} from '../accounts/store.js';

/**
 * Account endpoints. Everything here requires a verified identity — this is the one part of the
 * app that isn't playable as a guest, because there is nothing to attribute a guest's data to.
 *
 * The client treats every failure here as non-fatal: a run that can't be saved is still a run that
 * was played and scored. Nothing on these routes is allowed to become a prerequisite for playing.
 */

export const accountRouter = Router();

function identityOf(req: Request): Identity {
  // requireAuth has already run, so req.user is present.
  const user = req.user!;
  return { uid: user.uid, email: user.email, name: user.name };
}

/**
 * Recognises the Firestore setup failures that look identical from the client.
 *
 * gRPC reports all of these as a bare status code with an empty `details`, wrapped in a stack trace
 * that is entirely library internals — sixty lines that name every file except the one thing that
 * would help. Each of these means a specific console step was skipped, so each gets told.
 */
function describeFirestoreError(error: unknown): string | null {
  const code = (error as { code?: unknown })?.code;

  switch (code) {
    case 5: // NOT_FOUND
      return (
        'No Firestore database found for this project. Create one in the Firebase console under ' +
        'Build → Firestore Database → Create database, in Native mode (not Datastore mode). ' +
        'If you created a database with a name other than "(default)", set FIRESTORE_DATABASE_ID ' +
        'in .env to that name.'
      );
    case 7: // PERMISSION_DENIED
      return (
        'Firestore refused the request. Check that the service-account key belongs to this ' +
        'project, and that firestore.rules has been deployed: firebase deploy --only firestore:rules'
      );
    case 16: // UNAUTHENTICATED
      return 'Firestore rejected the service-account credentials. The key may be revoked or malformed.';
    case 14: // UNAVAILABLE
      return 'Could not reach Firestore. Check the network and try again.';
    default:
      return null;
  }
}

/** Turns expected infrastructure failures into a status and a message the caller can act on. */
function handle(res: Response, error: unknown) {
  if (error instanceof AccountsUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }

  const setupProblem = describeFirestoreError(error);
  if (setupProblem) {
    // One line, not the gRPC stack. The stack has no information in it that this message lacks.
    console.error(`[accounts] Firestore unavailable (code ${(error as { code?: unknown }).code}): ${setupProblem}`);
    res.status(503).json({ error: setupProblem });
    return;
  }

  console.error('[accounts]', error);
  res.status(500).json({ error: 'Something went wrong.' });
}

/** Guards the whole router: without Firestore there is no account system to talk to. */
accountRouter.use(requireAuth, (_req, res, next) => {
  if (!isFirestoreAvailable()) {
    res.status(503).json({ error: 'Accounts are not configured on this server.' });
    return;
  }
  next();
});

accountRouter.get('/me', async (req, res) => {
  try {
    res.json(await getOverview(identityOf(req)));
  } catch (error) {
    handle(res, error);
  }
});

accountRouter.patch('/me', async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? 'That update could not be applied.',
    });
    return;
  }

  const patch: ProfilePatch = {};

  if (parsed.data.displayName !== undefined) {
    const displayName = normalizeDisplayName(parsed.data.displayName);
    if (!displayName) {
      res.status(400).json({
        error: `Display name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} visible characters.`,
      });
      return;
    }
    patch.displayName = displayName;
  }

  // Passed through as-is, null included: null is how the client says "remove my picture".
  if (parsed.data.photo !== undefined) patch.photo = parsed.data.photo;
  if (parsed.data.avatarColor !== undefined) patch.avatarColor = parsed.data.avatarColor;

  try {
    res.json(await updateProfile(identityOf(req).uid, patch));
  } catch (error) {
    handle(res, error);
  }
});

accountRouter.post('/runs', async (req, res) => {
  const parsed = runSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'That run could not be saved.',
      // Surfaced because the only realistic cause is our own client sending the wrong shape, and
      // silently dropping runs would be a miserable bug to track down.
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return;
  }

  try {
    res.status(201).json(await saveRun(identityOf(req), parsed.data));
  } catch (error) {
    handle(res, error);
  }
});

accountRouter.get('/runs', async (req, res) => {
  const parsed = runQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid limit.' });
    return;
  }

  try {
    res.json({ runs: await listRuns(identityOf(req).uid, parsed.data.limit) });
  } catch (error) {
    handle(res, error);
  }
});

/**
 * Deletes the account and everything attached to it.
 *
 * Present because an account system that can only be created is not finished — if the app asks
 * someone to sign in, it owes them a way back out that actually removes their data rather than
 * just hiding it.
 */
accountRouter.delete('/', async (req, res) => {
  try {
    await deleteAccount(identityOf(req).uid);
    res.status(204).end();
  } catch (error) {
    handle(res, error);
  }
});
