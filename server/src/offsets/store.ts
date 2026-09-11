import admin from 'firebase-admin';
import type { OffsetConsensus, OffsetSubmission } from '@shared/types';
import { getFirestore } from '../firestore.js';
import { computeConsensus } from './consensus.js';

/**
 * Firestore access for the per-video offset store.
 *
 * Layout:
 *   offsets/{videoId}__{lrclibId}   submissions + the consensus derived from them
 *
 * Keyed on the pair, not on either alone. The same video can host different LRC entries (a track
 * appearing on both a single and an album) and the same track can be matched to several videos,
 * and an offset is only meaningful for one specific combination of the two.
 *
 * Nothing here is lyrics. A document holds a video id, a numeric track id and a list of
 * millisecond corrections — the same standing as the search cache, and the same distance from
 * content.
 */

export class OffsetsUnavailableError extends Error {
  constructor() {
    super('Offset sharing is not configured on this server.');
    this.name = 'OffsetsUnavailableError';
  }
}

/**
 * How many submissions a document keeps.
 *
 * Old measurements are not more wrong than new ones, so this is not about staleness — it is about
 * a document that would otherwise grow forever, and about keeping the quadratic clustering pass
 * bounded. When the cap is reached the oldest go, since a video that has changed makes them the
 * least trustworthy.
 */
const MAX_SUBMISSIONS = 200;

/** Rejects anything a person could not plausibly have measured. */
export const MAX_OFFSET_MS = 60_000;

function db(): admin.firestore.Firestore {
  const firestore = getFirestore();
  if (!firestore) throw new OffsetsUnavailableError();
  return firestore;
}

/** Firestore ids may not contain a slash; a video id may. Underscores keep it readable. */
export function offsetKey(videoId: string, lrclibId: number): string {
  return `${videoId.replace(/[^A-Za-z0-9_-]/g, '')}__${lrclibId}`;
}

const offsetRef = (videoId: string, lrclibId: number) =>
  db().collection('offsets').doc(offsetKey(videoId, lrclibId));

function readSubmissions(data: admin.firestore.DocumentData | undefined): OffsetSubmission[] {
  const stored = Array.isArray(data?.submissions) ? data.submissions : [];

  return stored
    .filter((entry): entry is OffsetSubmission => typeof entry?.offsetMs === 'number')
    .map((entry) => ({
      offsetMs: entry.offsetMs,
      submittedAt: typeof entry.submittedAt === 'number' ? entry.submittedAt : 0,
      uid: typeof entry.uid === 'string' ? entry.uid : null,
      source: entry.source === 'nudge' ? 'nudge' : 'tap',
    }));
}

const EMPTY: OffsetConsensus = {
  consensusOffsetMs: null,
  confidence: 'none',
  submissionCount: 0,
  agreeingCount: 0,
  spreadMs: 0,
};

/**
 * The consensus for one pairing.
 *
 * Reads the stored consensus rather than recomputing from submissions, because this runs on every
 * play and the write path already did the work. The stored value and the submissions cannot drift:
 * they are written in the same transaction.
 */
export async function getConsensus(videoId: string, lrclibId: number): Promise<OffsetConsensus> {
  const snapshot = await offsetRef(videoId, lrclibId).get();
  if (!snapshot.exists) return EMPTY;

  const data = snapshot.data() ?? {};
  const consensus = data.consensus as OffsetConsensus | undefined;

  // Recompute if the stored consensus predates a change to the algorithm — retuning the agreement
  // window should not require rewriting every document to take effect.
  if (!consensus || typeof consensus.confidence !== 'string') {
    return computeConsensus(readSubmissions(data));
  }

  return consensus;
}

/** Consensus for many videos against one track, for ranking. Missing pairings come back empty. */
export async function getConsensusMap(
  videoIds: string[],
  lrclibId: number,
): Promise<Map<string, OffsetConsensus>> {
  const result = new Map<string, OffsetConsensus>();
  if (videoIds.length === 0) return result;

  const firestore = db();
  const refs = videoIds.map((videoId) => firestore.collection('offsets').doc(offsetKey(videoId, lrclibId)));
  const snapshots = await firestore.getAll(...refs);

  snapshots.forEach((snapshot, index) => {
    const videoId = videoIds[index]!;
    if (!snapshot.exists) return;

    const data = snapshot.data() ?? {};
    const consensus = (data.consensus as OffsetConsensus | undefined) ?? computeConsensus(readSubmissions(data));
    result.set(videoId, consensus);
  });

  return result;
}

/**
 * Files a submission and recomputes the consensus.
 *
 * One transaction, because a submission that lands without its consensus being updated is a
 * measurement nobody will ever benefit from — the read path serves the stored consensus, so an
 * un-recomputed document is indistinguishable from one that was never submitted to.
 */
export async function submitOffset(input: {
  videoId: string;
  lrclibId: number;
  offsetMs: number;
  uid: string | null;
  source: 'tap' | 'nudge';
}): Promise<OffsetConsensus> {
  const firestore = db();
  const ref = offsetRef(input.videoId, input.lrclibId);

  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const existing = readSubmissions(snapshot.data());

    const submission: OffsetSubmission = {
      offsetMs: Math.round(input.offsetMs),
      submittedAt: Date.now(),
      uid: input.uid,
      source: input.source,
    };

    /*
     * One submission per person per pairing: a later measurement replaces their earlier one rather
     * than being counted alongside it. Without this, someone who nudges through a run and confirms
     * a few times would outvote everyone else on their own — and their last value is the one they
     * settled on anyway, so keeping the earlier attempts would weight their false starts.
     *
     * Guests are not deduplicated. There is nothing to identify them by, and inventing a
     * fingerprint to do it would be worse than accepting the noise the median already handles.
     */
    const kept = input.uid ? existing.filter((entry) => entry.uid !== input.uid) : existing;

    const submissions = [...kept, submission].slice(-MAX_SUBMISSIONS);
    const consensus = computeConsensus(submissions);

    tx.set(
      ref,
      {
        videoId: input.videoId,
        lrclibId: input.lrclibId,
        submissions,
        consensus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return consensus;
  });
}
