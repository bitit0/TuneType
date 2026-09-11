import admin from 'firebase-admin';
import type {
  AccountOverview,
  AccountStats,
  ProfilePatch,
  RunSubmission,
  SavedRun,
  StatAccumulators,
  TrackBest,
  UserProfile,
} from '@shared/types';
import { getFirestore } from '../firestore.js';
import { getFirebaseAdmin } from '../firebase.js';
import {
  applyRun,
  applyTrackBest,
  defaultAvatarColor,
  defaultDisplayName,
  deriveMetrics,
  emptyAccumulators,
  isAvatarColor,
  toAccountStats,
} from './stats.js';

/**
 * Firestore access for accounts.
 *
 * Layout:
 *   users/{uid}                  profile + lifetime accumulators
 *   users/{uid}/runs/{runId}     one document per saved run
 *   users/{uid}/bests/{lrclibId} personal best per track
 *
 * Bests are a separate collection rather than a map on the profile because a profile document is
 * read on every page load and would otherwise grow without limit as someone plays more tracks.
 */

export class AccountsUnavailableError extends Error {
  constructor() {
    super('Accounts are not configured on this server.');
    this.name = 'AccountsUnavailableError';
  }
}

function db(): admin.firestore.Firestore {
  const firestore = getFirestore();
  if (!firestore) throw new AccountsUnavailableError();
  return firestore;
}

const userRef = (uid: string) => db().collection('users').doc(uid);

/** Firestore hands back Timestamps; the client's contract is epoch milliseconds. */
function toMillis(value: unknown, fallback: number): number {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return fallback;
}

/** Old documents predate fields added later, so every accumulator is read defensively. */
function readAccumulators(data: admin.firestore.DocumentData | undefined): StatAccumulators {
  const empty = emptyAccumulators();
  const stored = (data?.stats ?? {}) as Partial<StatAccumulators>;
  return {
    runs: stored.runs ?? empty.runs,
    totalScore: stored.totalScore ?? empty.totalScore,
    bestScore: stored.bestScore ?? empty.bestScore,
    bestWpm: stored.bestWpm ?? empty.bestWpm,
    correctChars: stored.correctChars ?? empty.correctChars,
    typedChars: stored.typedChars ?? empty.typedChars,
    linesAttempted: stored.linesAttempted ?? empty.linesAttempted,
    linesCompleted: stored.linesCompleted ?? empty.linesCompleted,
    totalTypingMs: stored.totalTypingMs ?? empty.totalTypingMs,
  };
}

function readProfile(uid: string, data: admin.firestore.DocumentData): UserProfile {
  const createdAt = toMillis(data.createdAt, Date.now());
  return {
    uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : `player-${uid.slice(0, 6)}`,
    email: typeof data.email === 'string' ? data.email : null,
    photo: typeof data.photo === 'string' ? data.photo : null,
    // Profiles written before avatars existed have no color; deriving it from the uid means they
    // get a stable one rather than a different color on every read.
    avatarColor: isAvatarColor(data.avatarColor) ? data.avatarColor : defaultAvatarColor(uid),
    createdAt,
    updatedAt: toMillis(data.updatedAt, createdAt),
  };
}

export interface Identity {
  uid: string;
  email: string | null;
  name: string | null;
}

/**
 * Reads a profile, creating it on first sight.
 *
 * Provisioning happens here rather than at sign-up because sign-up never touches this server —
 * Google's popup and Firebase's email flow both complete entirely in the browser. The first
 * authenticated request is the earliest moment we can know an account exists, so it is the moment
 * the profile gets made.
 */
export async function ensureProfile(identity: Identity): Promise<UserProfile> {
  const ref = userRef(identity.uid);
  const snapshot = await ref.get();

  if (snapshot.exists) {
    const data = snapshot.data() ?? {};
    // Email can change on the provider side; keep the copy honest without touching the name, which
    // is the user's to set.
    if (identity.email && data.email !== identity.email) {
      await ref.update({ email: identity.email, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      data.email = identity.email;
    }
    return readProfile(identity.uid, data);
  }

  const now = Date.now();
  const profile: UserProfile = {
    uid: identity.uid,
    displayName: defaultDisplayName(identity.name, identity.email, identity.uid),
    email: identity.email,
    // Provider pictures are not copied in. Google's photo URL is rendered directly by the client
    // as a fallback, so mirroring it here would only add a stale copy that rots when they change it
    // — and `photo` means "a picture this user chose to upload", which is a different thing.
    photo: null,
    avatarColor: defaultAvatarColor(identity.uid),
    createdAt: now,
    updatedAt: now,
  };

  await ref.set({
    displayName: profile.displayName,
    email: profile.email,
    photo: null,
    avatarColor: profile.avatarColor,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    stats: emptyAccumulators(),
  });

  return profile;
}

/**
 * Applies a partial profile update.
 *
 * Only the fields actually present in the patch are written, so the picture editor and the rename
 * form can share this path without either erasing the other's work. `photo: null` is a real value
 * meaning "remove it" and is passed through; an absent `photo` leaves the stored one alone.
 */
export async function updateProfile(uid: string, patch: ProfilePatch): Promise<UserProfile> {
  const update: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (patch.displayName !== undefined) update.displayName = patch.displayName;
  if (patch.photo !== undefined) update.photo = patch.photo;
  if (patch.avatarColor !== undefined) update.avatarColor = patch.avatarColor;

  const ref = userRef(uid);
  await ref.update(update);

  const snapshot = await ref.get();
  return readProfile(uid, snapshot.data() ?? {});
}

function readRun(id: string, data: admin.firestore.DocumentData): SavedRun {
  const typingMs = data.typingMs ?? 0;
  const { accuracy, wpm } = deriveMetrics(data.correctChars ?? 0, data.typedChars ?? 0, typingMs);
  return {
    id,
    lrclibId: data.lrclibId ?? 0,
    title: data.title ?? '',
    artist: data.artist ?? '',
    album: data.album ?? null,
    videoId: data.videoId ?? '',
    totalScore: data.totalScore ?? 0,
    correctChars: data.correctChars ?? 0,
    typedChars: data.typedChars ?? 0,
    linesAttempted: data.linesAttempted ?? 0,
    linesCompleted: data.linesCompleted ?? 0,
    typingMs,
    elapsedMs: data.elapsedMs ?? 0,
    offsetMs: data.offsetMs ?? 0,
    // Zero on runs saved before required pace was tracked. Rendered as "unknown" rather than as a
    // song that demanded nothing — see the results screen.
    requiredWpm: data.requiredWpm ?? 0,
    playedAt: toMillis(data.playedAt, 0),
    accuracy,
    wpm,
  };
}

function readBest(data: admin.firestore.DocumentData): TrackBest {
  return {
    lrclibId: data.lrclibId ?? 0,
    title: data.title ?? '',
    artist: data.artist ?? '',
    bestScore: data.bestScore ?? 0,
    bestWpm: data.bestWpm ?? 0,
    bestAccuracy: data.bestAccuracy ?? 0,
    plays: data.plays ?? 0,
    lastPlayedAt: toMillis(data.lastPlayedAt, 0),
  };
}

/**
 * Saves a run and folds it into the account's totals.
 *
 * One transaction covers the run document, the lifetime accumulators and the track best, because
 * a run that is stored but not counted — or counted but not stored — leaves an account whose
 * history and headline numbers disagree, with no way to tell which one is wrong afterwards.
 */
export async function saveRun(
  identity: Identity,
  submission: RunSubmission,
): Promise<{ run: SavedRun; stats: AccountStats }> {
  await ensureProfile(identity);

  const firestore = db();
  const uid = identity.uid;
  const profileRef = userRef(uid);
  const runRef = profileRef.collection('runs').doc();
  const bestRef = profileRef.collection('bests').doc(String(submission.lrclibId));
  const playedAt = Date.now();

  const metrics = deriveMetrics(
    submission.correctChars,
    submission.typedChars,
    submission.typingMs,
  );

  const accumulators = await firestore.runTransaction(async (tx) => {
    // Every read must precede every write inside a transaction.
    const [profileSnap, bestSnap] = await Promise.all([tx.get(profileRef), tx.get(bestRef)]);

    const nextStats = applyRun(readAccumulators(profileSnap.data()), submission, metrics.wpm);
    const nextBest = applyTrackBest(
      bestSnap.exists ? readBest(bestSnap.data() ?? {}) : null,
      submission,
      metrics,
      playedAt,
    );

    tx.set(runRef, {
      ...submission,
      playedAt: admin.firestore.Timestamp.fromMillis(playedAt),
    });
    tx.update(profileRef, {
      stats: nextStats,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(bestRef, {
      ...nextBest,
      lastPlayedAt: admin.firestore.Timestamp.fromMillis(playedAt),
    });

    return nextStats;
  });

  return {
    run: { ...submission, id: runRef.id, playedAt, ...metrics },
    stats: toAccountStats(accumulators),
  };
}

export async function listRuns(uid: string, limit: number): Promise<SavedRun[]> {
  const snapshot = await userRef(uid)
    .collection('runs')
    .orderBy('playedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => readRun(doc.id, doc.data()));
}

async function listTopTracks(uid: string, limit: number): Promise<TrackBest[]> {
  const snapshot = await userRef(uid)
    .collection('bests')
    .orderBy('bestScore', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => readBest(doc.data()));
}

/** Everything the profile screen needs, in one round trip. */
export async function getOverview(identity: Identity): Promise<AccountOverview> {
  const profile = await ensureProfile(identity);
  const snapshot = await userRef(identity.uid).get();

  const [recentRuns, topTracks] = await Promise.all([
    listRuns(identity.uid, 10),
    listTopTracks(identity.uid, 5),
  ]);

  return {
    profile,
    stats: toAccountStats(readAccumulators(snapshot.data())),
    recentRuns,
    topTracks,
  };
}

/**
 * Deletes an account: history, profile, then the credential itself.
 *
 * In that order on purpose. If deletion fails partway the user still has a working sign-in and can
 * retry; killing the credential first would strand orphaned data belonging to someone who can no
 * longer authenticate to ask for its removal.
 */
export async function deleteAccount(uid: string): Promise<void> {
  const firestore = db();
  const ref = userRef(uid);

  // recursiveDelete handles the subcollections, which a document delete on its own would orphan.
  await firestore.recursiveDelete(ref);

  const app = getFirebaseAdmin();
  if (app) await admin.auth(app).deleteUser(uid);
}
