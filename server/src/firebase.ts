import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

/**
 * Lazy Firebase Admin initialization.
 *
 * Deliberately optional: the playable slice runs with no cloud setup at all, so a missing
 * service-account file must degrade to "auth verification unavailable" rather than crash the
 * server on boot. `optionalAuth` treats an uninitialized SDK the same as an absent token.
 */

/** The repo root — the same anchor `.env` is loaded from, so paths mean the same thing in both. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Resolves the credentials path against the repo root rather than the working directory.
 *
 * This matters more than it looks. `npm run dev:server` runs the script with its cwd set to
 * `server/`, so the `./serviceAccountKey.json` in `.env.example` would resolve to
 * `server/serviceAccountKey.json` — while `.env` itself is read from the repo root, which is
 * exactly where anyone would put the key file. The mismatch produces a file that is plainly there
 * and still "not found". Anchoring to the repo root makes the two agree.
 */
function resolveCredentialsPath(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

let app: admin.app.App | null = null;
let attempted = false;
/** Why initialization failed, for the health endpoint and the 503s. */
let unavailableReason: string | null = null;

export function getFirebaseAdmin(): admin.app.App | null {
  if (attempted) return app;
  attempted = true;

  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!configured) {
    unavailableReason = 'GOOGLE_APPLICATION_CREDENTIALS is not set in .env.';
    console.warn(`[auth] ${unavailableReason} Token verification is disabled; guests can still play.`);
    return null;
  }

  const credentialsPath = resolveCredentialsPath(configured);
  if (!existsSync(credentialsPath)) {
    unavailableReason = `Service-account key not found at ${credentialsPath}`;
    // Print the absolute path that was checked. "Not found" without a path is the kind of message
    // that sends people looking in the wrong directory.
    console.warn(
      `[auth] ${unavailableReason}\n` +
        '       Download one from the Firebase console: Project settings → Service accounts →\n' +
        '       Generate new private key. Token verification is disabled until then; the app still\n' +
        '       runs and guests can still play.',
    );
    return null;
  }

  try {
    // Read and pass the key explicitly rather than going through applicationDefault(), which
    // re-reads the env var and would resolve the relative path against the cwd all over again.
    const serviceAccount = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log(`[auth] Firebase Admin ready (project ${serviceAccount.project_id}).`);
  } catch (error) {
    unavailableReason = `Service-account key at ${credentialsPath} could not be used.`;
    console.error(`[auth] ${unavailableReason}`, error);
    app = null;
  }

  return app;
}

export function isAuthAvailable(): boolean {
  return getFirebaseAdmin() !== null;
}

/** Null when auth is working. Surfaced by /api/health so setup problems are visible, not guessed. */
export function authUnavailableReason(): string | null {
  getFirebaseAdmin();
  return unavailableReason;
}
