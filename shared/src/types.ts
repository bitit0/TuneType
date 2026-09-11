/**
 * Types shared by the client and the server.
 *
 * This module is TYPE-ONLY on purpose. Both sides import it with `import type`, so nothing here
 * survives compilation and neither runtime needs to resolve the `@shared` alias.
 */

// --- Branded millisecond units -------------------------------------------------------------
//
// Every timing value in this project is a millisecond number, but they come from four different
// clocks and adding the wrong pair produces a bug with no stack trace: the lyrics just feel
// slightly wrong. Branding them makes a mismatch a compile error instead.

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A position within the video's own timeline. What the player and VirtualClock report. */
export type VideoTimeMs = Brand<number, 'VideoTimeMs'>;

/** A timestamp from an LRC file, relative to the start of the recording. */
export type LrcTimeMs = Brand<number, 'LrcTimeMs'>;

/** A correction added to video time to line it up with LRC time. Can be negative. */
export type OffsetMs = Brand<number, 'OffsetMs'>;

/** A reading from `performance.now()`. Wall time, unrelated to any video. */
export type WallTimeMs = Brand<number, 'WallTimeMs'>;

export const asVideoTime = (n: number) => n as VideoTimeMs;
export const asLrcTime = (n: number) => n as LrcTimeMs;
export const asOffset = (n: number) => n as OffsetMs;
export const asWallTime = (n: number) => n as WallTimeMs;

// --- Lyrics ---------------------------------------------------------------------------------

/**
 * One synced line. `endMs` is derived from the next line's start, so lines tile the song with no
 * gaps — a line's window stays open until the next one begins.
 *
 * Lyrics are fetched from LRCLIB at play time and held in memory only. They are never written to
 * disk, never sent to our server, and never committed. See the legal posture in PROJECT_CONTEXT.md.
 */
export interface LyricLine {
  startMs: LrcTimeMs;
  endMs: LrcTimeMs;
  text: string;
}

/** An LRCLIB search result. The `syncedLyrics` payload is transient — see above. */
export interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  syncedLyrics: string | null;
}

/** An LRCLIB result we've confirmed is playable: synced, non-instrumental, parseable. */
export interface PlayableTrack {
  lrclibId: number;
  title: string;
  artist: string;
  album: string | null;
  durationSec: number | null;
  lines: LyricLine[];
}

// --- Video ----------------------------------------------------------------------------------

/**
 * How a candidate was uploaded, in descending order of how well its audio tends to match an LRC
 * file. This is the ranking from PROJECT_CONTEXT expressed as a type.
 *
 * `musicvideo` sits below `lyric` on purpose and is not a mistake: the official music video is the
 * intuitive first choice and the wrong one. It is the cut most likely to carry a spoken intro, a
 * label ident or an edited arrangement, so its timing is the least predictable. It still ranks
 * above `other`, which is where covers, live uploads and everything unidentifiable land.
 */
export type ChannelTier = 'topic' | 'official' | 'lyric' | 'musicvideo' | 'other';

export interface VideoCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSec: number;
}

export interface RankedCandidate extends VideoCandidate {
  tier: ChannelTier;
  score: number;
  /**
   * Excess video length over track length, in seconds. Negative means shorter than the track.
   *
   * Null when LRCLIB gave no duration for the track, which is not rare. Null rather than zero
   * because zero is a real and meaningful value here — an exact length match is the best possible
   * signal, and "we could not check" must not be able to impersonate it.
   */
  durationDeltaSec: number | null;
  /** Rejected candidates are still returned, sorted, so the UI can offer the best one with a warning. */
  rejected: boolean;
  rejectionReason?: string;
  /** Short plain-English notes on what earned or cost this candidate its place, for the UI. */
  notes: string[];
}

/**
 * A ranked search, as the server returns it.
 *
 * `cached` and `quota` are surfaced rather than kept internal because the quota is the binding
 * constraint on this feature — 100 searches a day, shared by everyone using the server. A UI that
 * can see what a search cost can explain a refusal instead of just failing.
 */
export interface VideoSearchResponse {
  candidates: RankedCandidate[];
  /** True when this answer came from the store and cost no quota. */
  cached: boolean;
  /**
   * Set only on a cache-only request: nothing is stored for this track, and finding out would cost
   * one of the day's searches. It is what lets the video screen load for free and then ask.
   */
  needsSearch?: boolean;
  quota: QuotaStatus;
}

export interface QuotaStatus {
  /** `search.list` calls made today, against the configured daily budget. */
  used: number;
  budget: number;
  /**
   * The day this counter belongs to, `YYYY-MM-DD`, in **Pacific time** — that is when YouTube
   * resets the real quota, and a counter that rolled over at local midnight would either free up
   * budget hours before Google does or hold it back long after.
   */
  day: string;
}

// --- Setlists -------------------------------------------------------------------------------
//
// Curated difficulty tiers. Everything else in this app finds songs by search — you type a title
// and take what LRCLIB has. A setlist is the opposite: a small hand-picked set where someone has
// already confirmed the video syncs, the lyrics are right and the song is worth playing, arranged
// so there is somewhere to start and somewhere to work towards.
//
// The required-WPM estimate grades a song automatically, and that is a genuinely useful number,
// but it only measures how fast the words arrive. It cannot see that a song is all long vowels and
// repeated choruses, or that it is dense with punctuation and proper nouns. So placement is a
// judgement a curator makes, with the estimate shown beside it as advice rather than as the answer.

/**
 * The four graded difficulties, easiest first.
 *
 * Shared with the automatic pace bands on purpose — one vocabulary, two sources. The estimate
 * suggests a band from timings alone; the curator decides the tier a song actually goes in, and
 * the two disagreeing is informative rather than a bug.
 */
export type PaceBand = 'easy' | 'medium' | 'hard' | 'insane';

/**
 * Where a curated song sits: one of the four graded difficulties, or Freestyle.
 *
 * Freestyle is deliberately outside `PaceBand` rather than a fifth step on the end of it, and the
 * type says so. The four bands are defined by a range of required WPM, so every song has one
 * whether or not anyone has judged it. Freestyle has no range and never can — it is the shelf for
 * songs that do not belong on a ladder, so it is the one tier the estimate can never suggest and
 * only a curator can choose. Making it a separate union member means a function returning a
 * measured band cannot accidentally return it.
 *
 * The concrete ordered list lives on each side (`SETLIST_TIERS` on the server, the band table in
 * the client's scoring constants) because this file is type-only. Both are keyed off these unions,
 * so adding a tier fails to compile until both sides account for it.
 */
export type SetlistTier = PaceBand | 'freestyle';

/**
 * One curated song: a track, the video it is known to sync with, and the numbers needed to preview
 * it without loading anything.
 *
 * Note what is stored and what is not. Title, artist and album are metadata; `requiredWpm`,
 * `peakWpm` and `lineCount` are aggregates over the lyrics, computed in the browser at the moment
 * of curation and sent as numbers. The lyrics themselves are not here and never will be — the same
 * rule that governs saved runs. A setlist is a list of pointers, not a library.
 */
export interface SetlistEntry {
  id: string;
  tier: SetlistTier;
  lrclibId: number;
  title: string;
  artist: string;
  album: string | null;
  /** The video the curator verified against this track. Also where the preview thumbnail comes from. */
  videoId: string;
  durationSec: number | null;
  requiredWpm: number;
  peakWpm: number;
  lineCount: number;
  addedAt: number;
  /** uid of the curator who added it. Null on entries added before attribution existed. */
  addedBy: string | null;
}

/** What a curator sends to add an entry. The server fills in id, timestamp and attribution. */
export type SetlistSubmission = Omit<SetlistEntry, 'id' | 'addedAt' | 'addedBy'>;

// --- Offsets --------------------------------------------------------------------------------
//
// The per-video offset store. A correctly matched video can still be shifted by a constant amount
// — a title card, a few seconds of silence, a different master — and no amount of better matching
// fixes that. The offset reconciles LRC timestamps to one specific upload, and because it cannot
// be computed from a cross-origin iframe, it is measured by people and agreed on by vote.

/** One person's measurement of how far a video's audio sits from its LRC timestamps. */
export interface OffsetSubmission {
  offsetMs: number;
  submittedAt: number;
  /**
   * Who submitted it, when they were signed in. Null for guests, who may submit freely — requiring
   * an account to calibrate would make the store's coverage depend on sign-ups.
   */
  uid: string | null;
  /** How it was measured. Taps and nudges have different error profiles and may diverge later. */
  source: 'tap' | 'nudge';
}

/**
 * How much an offset can be trusted.
 *
 * - `none` — nobody has calibrated this pairing.
 * - `provisional` — one or two submissions. Applied, but flagged, and the next player is asked to
 *   confirm it. This is what makes one person's calibration useful to everyone immediately.
 * - `confirmed` — enough submissions agree closely enough to stop asking.
 * - `contested` — submissions disagree by seconds, which means people are hearing different
 *   recordings. A timing problem is not what this is; a wrong video is.
 */
export type OffsetConfidence = 'none' | 'provisional' | 'confirmed' | 'contested';

export interface OffsetConsensus {
  /** Milliseconds to add to LRC timestamps. Null only when there is nothing to go on. */
  consensusOffsetMs: number | null;
  confidence: OffsetConfidence;
  submissionCount: number;
  /** How many submissions fall inside the agreement window of the consensus. */
  agreeingCount: number;
  /** Median absolute deviation, not standard deviation — one mistap must not inflate it. */
  spreadMs: number;
}

// --- Scoring --------------------------------------------------------------------------------

export interface Keystroke {
  /** The character the player typed. */
  char: string;
  /** The character expected at that position, or null when typed past the end of the line. */
  expected: string | null;
  correct: boolean;
  /** Offset-adjusted video time at which the key was pressed. */
  atMs: number;
}

export interface LineResult {
  lineIndex: number;
  targetLength: number;
  correctChars: number;
  typedChars: number;
  /** Offset-adjusted time the line was finished, or null if never completed. */
  completedAtMs: number | null;
  /** Time spent typing this line: first keystroke to completion. The WPM denominator. */
  typingMs: number;
  timingMultiplier: number;
  score: number;
}

export interface RunSummary {
  totalScore: number;
  /** Correct characters as a share of characters typed, 0-1. */
  accuracy: number;
  /** Words per minute over time spent typing, at the standard 5 characters per word. */
  wpm: number;
  /** Summed per-line typing time. What `wpm` is divided by. */
  typingMs: number;
  /** Wall-clock span from first keystroke to last. Reported, but not what speed is measured over. */
  elapsedMs: number;
  linesAttempted: number;
  linesCompleted: number;
  lines: LineResult[];
}

// --- Accounts -------------------------------------------------------------------------------
//
// Everything below is persisted server-side, so it is governed by the legal posture in
// PROJECT_CONTEXT.md. Read `RunSubmission` before adding a field to any of it.

/**
 * Palette keys for the generated fallback avatar. Names rather than hex, so the client's theme
 * owns the actual colors and the stored value survives a restyle.
 *
 * The concrete list lives on each side — `AVATAR_COLORS` in the server's stats module, and a
 * `Record<AvatarColor, ...>` palette in the client's avatar module — because this file is
 * type-only. Both are keyed off this union, so adding a color here fails to compile until both
 * sides account for it, which is a better guarantee than a shared array would give.
 */
export type AvatarColor = 'blue' | 'violet' | 'teal' | 'amber' | 'rose' | 'lime' | 'slate';

export interface UserProfile {
  uid: string;
  /** Chosen by the user; seeded from the provider's name or the email local-part on first sight. */
  displayName: string;
  email: string | null;
  /**
   * Custom picture as a self-contained `data:` URI, or null to fall back to the generated avatar.
   *
   * Stored inline in the profile document rather than in a storage bucket. The client downscales
   * to a small square before upload, so this is a few kilobytes — well inside Firestore's 1MB
   * document ceiling — and it keeps the whole feature working on the same credentials everything
   * else uses, with no bucket to provision, no CORS to configure and no second set of rules to get
   * wrong. If pictures ever need to be large, that trade flips and they belong in Storage.
   */
  photo: string | null;
  /** Backdrop for the generated avatar shown when `photo` is null. Seeded from the uid. */
  avatarColor: AvatarColor;
  /** Epoch milliseconds. Firestore timestamps are converted at the boundary so the client sees numbers. */
  createdAt: number;
  updatedAt: number;
}

/** Fields a user may change about themselves. All optional — a patch touches only what it names. */
export interface ProfilePatch {
  displayName?: string;
  photo?: string | null;
  avatarColor?: AvatarColor;
}

/**
 * What the client sends when a run ends.
 *
 * Note what is NOT here, and must never be added: the lyric lines, the text the player typed, or
 * any per-line breakdown that could reconstruct either. A completed run reduces to track metadata
 * plus counts. That is what keeps a lyrics cache from forming on our side one saved score at a
 * time — the same reason the client talks to LRCLIB directly instead of through our server.
 *
 * Track title and artist are metadata, not content, and are stored so a run can be labelled.
 */
export interface RunSubmission {
  lrclibId: number;
  title: string;
  artist: string;
  album: string | null;
  videoId: string;
  totalScore: number;
  correctChars: number;
  typedChars: number;
  linesAttempted: number;
  linesCompleted: number;
  /** Summed per-line typing time — the WPM denominator, not the song's length. */
  typingMs: number;
  /** Wall-clock span of the run, kept for context alongside `typingMs`. */
  elapsedMs: number;
  /** The manual timing correction in force at the end of the run. Feeds the offset store later. */
  offsetMs: number;
  /**
   * The pace this song demanded, in WPM — see `analyzeDifficulty` on the client.
   *
   * Stored rather than derived on read because the server has no lyrics to derive it from, and
   * never will. Without it, history could show how fast someone typed but not whether that was
   * enough, which is the comparison that makes a past run mean anything.
   *
   * It is an aggregate of character counts and timings, not content: one number per track, from
   * which nothing about the words can be recovered. Same standing as `correctChars`.
   */
  requiredWpm: number;
}

export interface SavedRun extends RunSubmission {
  id: string;
  playedAt: number;
  /** Derived on the server from the counts above, never sent by the client. */
  accuracy: number;
  wpm: number;
}

/**
 * Running totals for an account. Stored as accumulators only; `accuracy` and `wpm` are recomputed
 * from them on every read, so the headline numbers can never drift away from what they summarize.
 */
export interface StatAccumulators {
  runs: number;
  totalScore: number;
  bestScore: number;
  bestWpm: number;
  correctChars: number;
  typedChars: number;
  linesAttempted: number;
  linesCompleted: number;
  /** Summed typing time across every run. The lifetime WPM denominator. */
  totalTypingMs: number;
}

export interface AccountStats extends StatAccumulators {
  /** Lifetime accuracy across every character ever typed, 0-1. */
  accuracy: number;
  /** Lifetime WPM across all time spent typing. */
  wpm: number;
}

/** A personal best for one track, so replaying a song has something to beat. */
export interface TrackBest {
  lrclibId: number;
  title: string;
  artist: string;
  bestScore: number;
  bestWpm: number;
  bestAccuracy: number;
  plays: number;
  lastPlayedAt: number;
}

/** Everything the profile screen needs, in one round trip. */
export interface AccountOverview {
  profile: UserProfile;
  stats: AccountStats;
  recentRuns: SavedRun[];
  topTracks: TrackBest[];
}
