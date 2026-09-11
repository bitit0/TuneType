import type { Auth } from 'firebase/auth';

/**
 * Firebase client init, deliberately optional.
 *
 * Signing in unlocks nothing in v0 — guest play is the default path — so an unconfigured project
 * must leave the game fully playable rather than blocking boot. Everything auth-related checks
 * `isAuthConfigured()` first and simply hides itself when false.
 *
 * These values are public identifiers, not secrets. The service-account key is the secret half and
 * lives only on the server.
 *
 * The SDK is loaded on demand rather than imported at the top of this file. Statically importing
 * it put the whole of `firebase/app` and `firebase/auth` in the entry bundle — the largest single
 * thing the app downloaded — on behalf of a feature that unlocks nothing and that a guest never
 * touches. `isAuthConfigured` reads environment variables only, so the common path never fetches
 * the SDK at all. The `import type` above is erased at build time and costs nothing.
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function isAuthConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

/**
 * The initialized SDK, or null when this build has no Firebase project.
 *
 * The promise is cached rather than the resolved value, so concurrent callers during startup share
 * one fetch and one `initializeApp` instead of racing to create several.
 */
let authPromise: Promise<Auth> | null = null;

export function getFirebaseAuth(): Promise<Auth | null> {
  if (!isAuthConfigured()) return Promise.resolve(null);

  authPromise ??= (async () => {
    const [{ initializeApp }, { getAuth }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    return getAuth(initializeApp(config));
  })();

  return authPromise;
}
