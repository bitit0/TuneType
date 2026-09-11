import type { NextFunction, Request, Response } from 'express';
import admin from 'firebase-admin';
import { getFirebaseAdmin } from '../firebase.js';


declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** `name` is the provider's display name — Google supplies one, email sign-up does not. */
      user?: {
        uid: string;
        email: string | null;
        name: string | null;
        /**
         * Whether the provider vouches for the email address. Load-bearing for admin checks —
         * see `isAdmin`, where an unverified address is worth nothing.
         */
        emailVerified: boolean;
      };
    }
  }
}

/**
 * Attaches `req.user` when a valid Firebase ID token is present, and does nothing when it is not.
 *
 * Never rejects. Guest play is the default path in v0, and nothing here is gated — this exists so
 * that later endpoints (offset submissions, saved scores) can attribute a write to a user without
 * the request pipeline having to be restructured around auth after the fact.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  const app = getFirebaseAdmin();
  if (!app) return next();

  try {
    const decoded = await admin.auth(app).verifyIdToken(header.slice('Bearer '.length));
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      emailVerified: decoded.email_verified === true,
    };
  } catch {
    // An expired or forged token is treated exactly like no token: the caller is a guest.
  }

  next();
}

/**
 * Gate for endpoints that genuinely need an identity — currently everything under /api/account.
 *
 * Distinguishes "you are not signed in" from "this server cannot check whether you are". Both used
 * to answer 401 "Sign in required.", which is an actively wrong diagnosis in the second case: the
 * user *is* signed in, the browser sent a perfectly good token, and the server has no service
 * account to verify it with. Telling them to sign in sends them to re-do the one thing that already
 * worked. A missing credential is a server configuration fault, so it answers 503.
 */
function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether this request comes from a curator.
 *
 * Admin status is granted by environment variable, not by a flag in the database, and that is the
 * whole security design. A stored flag needs some way to set the first one, and every way of doing
 * that is either a bootstrapping endpoint that must then be defended forever or a manual console
 * edit that is indistinguishable from an attacker's. A value only the person running the server
 * can set has neither problem, and revoking is deleting a line.
 *
 * **Matching by email requires the provider to have verified it.** Firebase email/password sign-up
 * will happily let anyone create an account claiming any address; what it will not do is mark that
 * address verified without the owner clicking a link. Without this check, `ADMIN_EMAILS` would
 * amount to "whoever registers this address first", which is the opposite of an access control.
 * Google sign-in arrives verified, so in practice this costs the real admin nothing.
 */
export function isAdmin(user: Request['user']): boolean {
  if (!user) return false;

  if (envList('ADMIN_UIDS').includes(user.uid.toLowerCase())) return true;

  if (!user.email || !user.emailVerified) return false;
  return envList('ADMIN_EMAILS').includes(user.email.toLowerCase());
}

/**
 * Gate for curation endpoints.
 *
 * Answers 404 rather than 403 to a signed-in non-admin. There is nothing to gain from confirming
 * that an admin surface exists at this path to someone who cannot use it, and a curated-songs
 * feature is not so important that its own discoverability is worth more than saying nothing.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req.user)) return next();

  if (!req.user) {
    requireAuth(req, res, next);
    return;
  }

  res.status(404).json({ error: 'Not found.' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();

  const presentedToken = req.headers.authorization?.startsWith('Bearer ') ?? false;

  if (presentedToken && !getFirebaseAdmin()) {
    res.status(503).json({
      error:
        'This server cannot verify sign-ins: it has no Firebase service-account key. ' +
        'Accounts are unavailable until GOOGLE_APPLICATION_CREDENTIALS points at a valid key.',
    });
    return;
  }

  res.status(401).json({
    error: presentedToken
      ? 'Your session could not be verified. Try signing out and back in.'
      : 'Sign in required.',
  });
}
