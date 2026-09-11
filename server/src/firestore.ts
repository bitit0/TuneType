import admin from 'firebase-admin';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebase.js';

/**
 * Firestore handle, optional for the same reason the Admin SDK is.
 *
 * The playable slice runs with no cloud setup at all, so a missing service account has to mean
 * "accounts are unavailable", not "the server won't boot". Every caller checks for null and the
 * account routes turn that into a 503 the client already knows how to shrug off.
 */

let db: admin.firestore.Firestore | null = null;
let attempted = false;

export function getFirestore(): admin.firestore.Firestore | null {
  if (attempted) return db;
  attempted = true;

  const app = getFirebaseAdmin();
  if (!app) return null;

  try {
    /*
     * Google now lets a project hold several named Firestore databases, and the console will
     * happily let you create one called something other than "(default)". The Admin SDK always
     * targets "(default)" unless told otherwise, and a mismatch surfaces as a bare NOT_FOUND on
     * every read — indistinguishable from having no database at all. This env var is the escape
     * hatch for that case.
     */
    const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
    db = databaseId ? getAdminFirestore(app, databaseId) : getAdminFirestore(app);

    // Undefined is what an optional field looks like coming off a JSON body; writing it should
    // clear the field rather than throw halfway through a transaction.
    db.settings({ ignoreUndefinedProperties: true });

    if (databaseId) console.log(`[accounts] Using Firestore database "${databaseId}".`);
  } catch (error) {
    console.error('[accounts] Firestore unavailable:', error);
    db = null;
  }

  return db;
}

export function isFirestoreAvailable(): boolean {
  return getFirestore() !== null;
}
