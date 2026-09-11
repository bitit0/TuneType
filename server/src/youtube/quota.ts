import type { QuotaStatus } from '@shared/types';
import { getFirestore } from '../firestore.js';

/**
 * The daily `search.list` budget.
 *
 * This is the binding constraint on the whole feature. YouTube gives a free project 10,000 units a
 * day; `search.list` costs 100 of them and `videos.list` costs 1. That is a hard ceiling of about
 * 100 searches per day for every user of this server put together, and there is no way to buy more
 * without a quota-increase application. Overspending does not degrade — the API simply starts
 * returning 403 `quotaExceeded` until midnight Pacific.
 *
 * So the budget is enforced here rather than hoped for. The cache is what makes the budget last;
 * this is what stops a bug in the cache from costing a whole day.
 */

const DEFAULT_BUDGET = 80;

/** Formats "now" as the YYYY-MM-DD that YouTube's own quota reset uses. */
export function quotaDay(now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD, which sorts and compares as a string. The time zone is the point:
  // Google resets at midnight Pacific, so a counter keyed on any other day boundary would free up
  // budget hours early or hold it back hours late.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function searchBudget(): number {
  const configured = Number(process.env.YOUTUBE_SEARCH_DAILY_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_BUDGET;
}

let day = quotaDay();
let used = 0;
/** Whether the persisted count for `day` has been read back yet. See `syncFromStore`. */
let loaded = false;

function rollOver() {
  const today = quotaDay();
  if (today === day) return;
  day = today;
  used = 0;
  loaded = false;
}

function quotaDoc() {
  const db = getFirestore();
  return db ? db.collection('youtubeQuota').doc(day) : null;
}

/**
 * Reads today's count back from Firestore once per process per day.
 *
 * Without this, restarting the server resets the counter to zero while Google's is untouched — and
 * in development the server restarts on every file save. A handful of restarts is all it takes to
 * spend a day's real quota while our counter still reads single digits.
 *
 * When Firestore is not configured the in-memory count is all there is, which is honest: that
 * setup has no accounts either, and is not the one running long enough to matter.
 */
async function syncFromStore(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const doc = quotaDoc();
  if (!doc) return;

  try {
    const snapshot = await doc.get();
    const stored = snapshot.get('searches');
    if (typeof stored === 'number' && stored > used) used = stored;
  } catch (error) {
    // A quota counter that cannot be read is not a reason to refuse to search. Worst case we spend
    // against a low estimate and YouTube itself refuses us, which is the same failure one day
    // earlier than it would otherwise arrive.
    console.warn('[youtube] Could not read the persisted quota count:', error);
  }
}

export async function quotaStatus(): Promise<QuotaStatus> {
  rollOver();
  await syncFromStore();
  return { used, budget: searchBudget(), day };
}

/** True when there is room for one more `search.list` call today. */
export async function canSearch(): Promise<boolean> {
  const { used: spent, budget } = await quotaStatus();
  return spent < budget;
}

/**
 * Records a search. Called after the request goes out, not before — a call that failed to leave
 * the process cost nothing, and pre-counting would leak budget on every network error.
 */
export async function recordSearch(): Promise<void> {
  rollOver();
  used += 1;

  const doc = quotaDoc();
  if (!doc) return;

  try {
    // Incrementing server-side rather than writing our own total keeps the count right if two
    // processes ever share one project.
    const { FieldValue } = await import('firebase-admin/firestore');
    await doc.set({ searches: FieldValue.increment(1), day }, { merge: true });
  } catch (error) {
    console.warn('[youtube] Could not persist the quota count:', error);
  }
}

/** Test seam: forget everything this module remembers. */
export function __resetQuota(): void {
  day = quotaDay();
  used = 0;
  loaded = false;
}
