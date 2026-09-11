import type { VideoCandidate } from '@shared/types';
import { getFirestore } from '../firestore.js';

/**
 * The search-result cache.
 *
 * "Resolve a video ID once, store it, never search for that track again" is the rule that makes a
 * 100-search daily ceiling workable, and this is where it is kept. Coverage compounds: every track
 * anyone searches is free for everyone afterwards.
 *
 * What is stored is the candidate list — video ids, titles, channel names, durations. That is
 * metadata about our matching, not content, so it sits comfortably inside the legal posture that
 * rules out a lyrics cache. Nothing here has ever seen a lyric.
 *
 * The ranking is deliberately NOT stored. It is recomputed from the cached candidates on every
 * read so that tuning the heuristics improves past searches too, instead of leaving a layer of
 * fossilised orderings that can only be fixed by spending quota again.
 */

/** Cached candidates go stale slowly: uploads are removed occasionally, re-titled almost never. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  candidates: VideoCandidate[];
  fetchedAt: number;
}

const memory = new Map<string, CacheEntry>();

/**
 * Firestore document ids may not contain a slash and are awkward to read with spaces. The key is
 * already normalized to lowercase alphanumerics, spaces and one pipe, so this is total.
 */
function docId(key: string): string {
  return key.replace(/\|/g, '--').replace(/ /g, '_');
}

function fresh(entry: CacheEntry | undefined): CacheEntry | null {
  if (!entry) return null;
  return Date.now() - entry.fetchedAt < TTL_MS ? entry : null;
}

export async function readCache(key: string): Promise<VideoCandidate[] | null> {
  const local = fresh(memory.get(key));
  if (local) return local.candidates;

  const db = getFirestore();
  if (!db) return null;

  try {
    const snapshot = await db.collection('youtubeSearches').doc(docId(key)).get();
    if (!snapshot.exists) return null;

    const entry = snapshot.data() as CacheEntry | undefined;
    const stored = fresh(entry);
    if (!stored) return null;

    // Promote into memory so a warm process stops paying for the round trip.
    memory.set(key, stored);
    return stored.candidates;
  } catch (error) {
    // A cache that cannot be read must not take searching down with it. The cost of getting this
    // wrong is quota, and quota is exactly what the budget check exists to bound.
    console.warn('[youtube] Could not read the search cache:', error);
    return null;
  }
}

export async function writeCache(key: string, candidates: VideoCandidate[]): Promise<void> {
  const entry: CacheEntry = { candidates, fetchedAt: Date.now() };
  memory.set(key, entry);

  const db = getFirestore();
  if (!db) return;

  try {
    await db.collection('youtubeSearches').doc(docId(key)).set(entry);
  } catch (error) {
    // The in-memory copy still holds, so this process is fine. Only a restart pays for it again.
    console.warn('[youtube] Could not persist the search cache:', error);
  }
}

/** Test seam. */
export function __clearMemoryCache(): void {
  memory.clear();
}
