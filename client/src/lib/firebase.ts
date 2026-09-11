import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase client init, deliberately optional.
 *
 * Signing in unlocks nothing in v0 — guest play is the default path — so an unconfigured project
 * must leave the game fully playable rather than blocking boot. Everything auth-related checks
 * `isAuthConfigured()` first and simply hides itself when false.
 *
 * These values are public identifiers, not secrets. The service-account key is the secret half and
 * lives only on the server.
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function isAuthConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

export function getFirebaseAuth(): Auth | null {
  if (!isAuthConfigured()) return null;
  if (!auth) {
    app = initializeApp(config);
    auth = getAuth(app);
  }
  return auth;
}
