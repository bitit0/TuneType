import admin from 'firebase-admin';
import type { SetlistEntry, SetlistSubmission, SetlistTier } from '@shared/types';
import { getFirestore } from '../firestore.js';

/**
 * Firestore access for curated setlists.
 *
 * Layout:
 *   setlists/{entryId}   one curated song, carrying its tier
 *
 * Flat rather than nested under a tier document, because the page shows every tier at once and one
 * collection read serves the whole screen. Moving a song between tiers is then a field update
 * rather than a delete and a re-create, which matters when curation is the point of the feature.
 *
 * As everywhere else: identifiers, metadata and aggregate numbers. No lyrics.
 */

export class SetlistsUnavailableError extends Error {
  constructor() {
    super('Setlists are not configured on this server.');
    this.name = 'SetlistsUnavailableError';
  }
}

/**
 * Easiest first, with Freestyle last.
 *
 * Freestyle's position is presentation, not difficulty — it is not "harder than Insane", it is off
 * the scale. Last is simply where an ungraded shelf belongs once the ladder has been read.
 *
 * Keyed off `SetlistTier`, so adding one there fails to compile until it is listed here.
 */
export const SETLIST_TIERS: readonly SetlistTier[] = ['easy', 'medium', 'hard', 'insane', 'freestyle'];

export function isSetlistTier(value: unknown): value is SetlistTier {
  return typeof value === 'string' && (SETLIST_TIERS as readonly string[]).includes(value);
}

function db(): admin.firestore.Firestore {
  const firestore = getFirestore();
  if (!firestore) throw new SetlistsUnavailableError();
  return firestore;
}

const collection = () => db().collection('setlists');

function toMillis(value: unknown, fallback: number): number {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return fallback;
}

function readEntry(id: string, data: admin.firestore.DocumentData): SetlistEntry {
  return {
    id,
    tier: isSetlistTier(data.tier) ? data.tier : 'medium',
    lrclibId: data.lrclibId ?? 0,
    title: data.title ?? '',
    artist: data.artist ?? '',
    album: data.album ?? null,
    videoId: data.videoId ?? '',
    durationSec: typeof data.durationSec === 'number' ? data.durationSec : null,
    requiredWpm: data.requiredWpm ?? 0,
    peakWpm: data.peakWpm ?? 0,
    lineCount: data.lineCount ?? 0,
    addedAt: toMillis(data.addedAt, 0),
    addedBy: typeof data.addedBy === 'string' ? data.addedBy : null,
  };
}

/**
 * Every entry, ordered within each tier by the pace it demands.
 *
 * Sorted rather than manually arranged. Within one tier the required WPM is a genuine difficulty
 * ordering, so it gives a curator a working progression for free — and it means adding a song
 * never involves deciding where in a list it goes.
 */
export async function listEntries(): Promise<SetlistEntry[]> {
  const snapshot = await collection().get();

  const entries = snapshot.docs.map((doc) => readEntry(doc.id, doc.data()));

  return entries.sort((a, b) => {
    const tierDelta = SETLIST_TIERS.indexOf(a.tier) - SETLIST_TIERS.indexOf(b.tier);
    if (tierDelta !== 0) return tierDelta;
    if (a.requiredWpm !== b.requiredWpm) return a.requiredWpm - b.requiredWpm;
    return a.addedAt - b.addedAt;
  });
}

/**
 * Adds a song, or updates it in place if that track is already curated.
 *
 * Keyed on the track rather than on the track-and-video pairing: a song belongs in one tier, and
 * re-adding it with a better video is a correction, not a second entry. Making that an update
 * rather than a duplicate is the difference between a curated list and an append-only log.
 */
export async function addEntry(
  submission: SetlistSubmission,
  addedBy: string,
): Promise<SetlistEntry> {
  const existing = await collection().where('lrclibId', '==', submission.lrclibId).limit(1).get();
  const ref = existing.empty ? collection().doc() : existing.docs[0]!.ref;
  const addedAt = existing.empty ? Date.now() : toMillis(existing.docs[0]!.get('addedAt'), Date.now());

  await ref.set(
    {
      ...submission,
      addedBy,
      addedAt: admin.firestore.Timestamp.fromMillis(addedAt),
    },
    { merge: true },
  );

  return { ...submission, id: ref.id, addedAt, addedBy };
}

/** Moves an entry to another tier. The one edit curation actually needs. */
export async function moveEntry(id: string, tier: SetlistTier): Promise<void> {
  await collection().doc(id).update({ tier });
}

export async function removeEntry(id: string): Promise<void> {
  await collection().doc(id).delete();
}
