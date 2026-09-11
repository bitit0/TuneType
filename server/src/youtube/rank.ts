import type { ChannelTier, OffsetConsensus, RankedCandidate, VideoCandidate } from '@shared/types';
import { isWrongVideoSignal } from '../offsets/consensus.js';

/**
 * Ranking YouTube candidates for a known track.
 *
 * The search direction matters and is fixed by the design: we start from a canonical LRCLIB track
 * — artist, title, album, duration — and look for a video of it. We never find a video first and
 * then hunt for lyrics. Everything here assumes the track is the known quantity and the video is
 * the thing under suspicion.
 *
 * This module is pure. It takes candidates and a track and returns an ordering, with no network
 * and no clock, which is what makes the heuristics testable against fixtures rather than against
 * whatever YouTube returns today.
 */

export interface TrackForRanking {
  title: string;
  artist: string;
  /** LRCLIB duration in seconds. Null happens — a fair number of entries carry no duration. */
  durationSec: number | null;
}

/**
 * What the offset store has learned about a candidate, keyed by video id.
 *
 * This is the feedback loop the design is built around, and it runs the opposite way from
 * everything else here: the other signals are guesses made from a title string before anyone has
 * watched anything, while this is evidence from people who actually played the video. So it gets
 * to overrule them.
 */
export type OffsetSignals = Map<string, OffsetConsensus>;

// --- Tunables ---------------------------------------------------------------------------------
//
// Same convention as the scoring constants: first guesses with the reasoning attached, meant to be
// retuned once there's real search output to look at.

/**
 * Base score per tier. The gaps are wide because tier dominates every other signal — a Topic
 * upload with an awkward duration is still a better bet than a music video with a perfect one.
 */
const TIER_BASE: Record<ChannelTier, number> = {
  topic: 100,
  official: 80,
  lyric: 60,
  musicvideo: 35,
  other: 20,
};

/**
 * How much shorter than the track a video may be before it is rejected.
 *
 * The rule is "reject anything shorter than the track", but both numbers are noisy: LRCLIB
 * durations are user-supplied and often rounded, and YouTube reports whole seconds. Two seconds of
 * slack absorbs that without letting a radio edit through — edits differ by tens of seconds.
 */
const SHORTFALL_GRACE_SEC = 2;

/**
 * Excess length beyond which a video is rejected as "not this track alone".
 *
 * Five minutes past the track is no longer an intro. It is a full-album upload, an extended mix or
 * a compilation, and while a constant offset could in principle line the lyrics up inside it, the
 * offset would be minutes long and every consensus submission would be measuring a different
 * thing.
 */
const MAX_EXCESS_SEC = 300;

/** Penalty per second of excess length, and its ceiling. Prefers the smallest positive delta. */
const EXCESS_PENALTY_PER_SEC = 0.6;
const MAX_EXCESS_PENALTY = 30;

/** Cost of the video title not containing the track title at all. Suspicious, not disqualifying. */
const TITLE_MISMATCH_PENALTY = 20;

/** Small credit for the artist appearing in the channel name — an upload from the right place. */
const ARTIST_CHANNEL_BONUS = 8;

/**
 * Credit for a video people have successfully timed against this track.
 *
 * Sized to reorder candidates *within* reach of each other, not to jump a whole tier. That is a
 * deliberate limit: a confirmed timing means "we know how to correct this video", which is not the
 * same as "this video is better". An unplayed Topic upload has no submissions because nobody has
 * tried it yet, not because anyone found a problem — and it is still the distributor's own master,
 * which is the strongest evidence available about what the audio actually is.
 *
 * Demotion is the asymmetric half of this. Evidence that a video *cannot* be timed is conclusive
 * in a way that evidence it can be is not, so that path rejects outright rather than subtracting
 * points.
 */
const CONFIRMED_OFFSET_BONUS = 25;
const PROVISIONAL_OFFSET_BONUS = 8;

// --- Text normalization -----------------------------------------------------------------------

/**
 * Folds a title or artist to something comparable: lowercase, accents stripped, punctuation
 * flattened to single spaces.
 *
 * Stripping accents matters more than it looks — "Beyoncé" and "Beyonce" are the same artist, and
 * the two spellings appear on the same video roughly at random.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The cache key for a track. Artist and title only — deliberately not the album or duration.
 *
 * A track is often on a single, an album and a deluxe reissue as three LRCLIB entries with three
 * ids and three durations, all of which want the same video. Keying on the pair that identifies
 * the recording means the second entry is a cache hit rather than another 100 quota units.
 */
export function searchCacheKey(track: TrackForRanking): string {
  return `${normalizeText(track.artist)}|${normalizeText(track.title)}`;
}

// --- Duration ---------------------------------------------------------------------------------

/**
 * Parses the ISO 8601 duration `videos.list` returns (`PT4M13S`) into seconds.
 *
 * Live streams report `P0D`, which parses to zero here and is then rejected by the shortfall rule
 * — which is the right outcome for a different reason than the one it looks like.
 */
export function parseIsoDuration(iso: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso.trim());
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return Number.isFinite(total) ? Math.round(total) : null;
}

// --- Classification ---------------------------------------------------------------------------

/**
 * Markers that mean the audio is a different recording from the one the LRC file was timed
 * against. These are not timing problems that an offset could fix — the arrangement itself
 * differs, so no constant shift lines them up.
 */
const DISQUALIFYING: ReadonlyArray<{ pattern: RegExp; reason: string; raw?: boolean }> = [
  { pattern: /\bkaraoke\b/, reason: 'karaoke version' },
  { pattern: /\binstrumental\b/, reason: 'instrumental' },
  { pattern: /\b(cover|covered by)\b/, reason: 'cover version' },
  { pattern: /\bremix\b/, reason: 'remix' },
  { pattern: /\bnightcore\b/, reason: 'nightcore edit' },
  { pattern: /\b(sped up|speed up|slowed|reverb|8d audio)\b/, reason: 'speed or effect edit' },
  { pattern: /\breaction\b/, reason: 'reaction video' },
  { pattern: /\b(live at|live from|live in|live on|live version|live performance)\b/, reason: 'live performance' },
  // `raw` marks a pattern that needs the punctuation normalization would strip. A bare "live" is
  // only a signal when it is bracketed off as a qualifier — "(Live)" — because unbracketed it is
  // just as likely to be a word in the song's own title.
  { pattern: /[([]\s*live\s*[)\]]/, reason: 'live performance', raw: true },
];

/**
 * Whether a video title disqualifies itself.
 *
 * The track title is passed in so a song that genuinely contains one of these words is not
 * rejected by its own name — "Live Forever", "Karaoke" by Boygenius, anything released as a remix
 * in its own right. If the marker is already in the track we are looking for, its appearance in
 * the video title carries no information.
 */
export function disqualifyingReason(videoTitle: string, trackTitle: string): string | null {
  const video = normalizeText(videoTitle);
  const track = normalizeText(trackTitle);

  for (const { pattern, reason, raw } of DISQUALIFYING) {
    const haystack = raw ? videoTitle.toLowerCase() : video;
    const trackHaystack = raw ? trackTitle.toLowerCase() : track;
    if (!pattern.test(haystack)) continue;
    if (pattern.test(trackHaystack)) continue;
    return reason;
  }

  return null;
}

const OFFICIAL_AUDIO = /\b(official audio|full album|topic|audio only|hq audio|official lyric)\b/;
const MUSIC_VIDEO = /\b(official (music )?video|official video|m\/?v)\b/;
const LYRIC_VIDEO = /\blyrics?\b/;

/**
 * Places a candidate in a tier.
 *
 * The `- Topic` check is the highest-value signal in the whole system and the cheapest: YouTube
 * generates those channels from the distributor's own delivery, so the audio is the studio master
 * with nothing before it. LRC timestamps land on such uploads with near-zero offset, which is why
 * it is tested first and why nothing else can promote a candidate to that tier.
 */
export function classifyTier(candidate: VideoCandidate, track: TrackForRanking): ChannelTier {
  const channel = candidate.channelTitle.trim();
  if (/-\s*topic$/i.test(channel)) return 'topic';

  const title = normalizeText(candidate.title);
  const normalizedChannel = normalizeText(channel);
  const artist = normalizeText(track.artist);

  // VEVO and a channel named for the artist both mean "the rights holder uploaded this", which
  // settles who posted it but not which cut it is — that is what the title checks below decide.
  const fromArtist =
    artist.length > 0 && (normalizedChannel.includes(artist) || /\bvevo\b/.test(normalizedChannel));

  // Order matters: a title saying both "official video" and "lyrics" is a lyric video that the
  // uploader also called official, and lyric videos carry the more reliable audio of the two.
  if (LYRIC_VIDEO.test(title)) return 'lyric';
  if (MUSIC_VIDEO.test(title)) return 'musicvideo';
  if (OFFICIAL_AUDIO.test(title)) return 'official';

  // An untitled-as-anything upload from the artist's own channel is almost always the plain audio
  // or an album track. From anyone else it is unidentifiable, and unidentifiable is `other`.
  return fromArtist ? 'official' : 'other';
}

// --- Ranking ----------------------------------------------------------------------------------

function scoreCandidate(
  candidate: VideoCandidate,
  track: TrackForRanking,
  signals: OffsetSignals,
): RankedCandidate {
  const tier = classifyTier(candidate, track);
  const notes: string[] = [];

  let score = TIER_BASE[tier];
  let rejected = false;
  let rejectionReason: string | undefined;

  // Notes are facts about this candidate only. What a tier *means* is not repeated here — the UI
  // labels the tier and explains it once, rather than every row saying the same sentence.

  // Duration. With no LRCLIB duration there is nothing to compare against, and inventing a
  // comparison would be worse than admitting the check cannot run.
  const durationDeltaSec = track.durationSec === null ? null : candidate.durationSec - track.durationSec;

  if (durationDeltaSec === null) {
    notes.push('No track duration from LRCLIB — length not checked');
  } else if (durationDeltaSec < -SHORTFALL_GRACE_SEC) {
    rejected = true;
    rejectionReason = `${formatSeconds(-durationDeltaSec)} shorter than the track — likely a radio edit or a different version`;
  } else if (durationDeltaSec > MAX_EXCESS_SEC) {
    rejected = true;
    rejectionReason = `${formatSeconds(durationDeltaSec)} longer than the track — likely a full album or compilation`;
  } else if (durationDeltaSec > 0) {
    score -= Math.min(MAX_EXCESS_PENALTY, durationDeltaSec * EXCESS_PENALTY_PER_SEC);
    if (durationDeltaSec > 10) notes.push(`${formatSeconds(durationDeltaSec)} longer than the track`);
  }

  const disqualified = disqualifyingReason(candidate.title, track.title);
  if (disqualified && !rejected) {
    rejected = true;
    rejectionReason = `Looks like a ${disqualified}`;
  }

  // Title check. YouTube's relevance ranking is good, but "good" includes results that merely
  // mention the artist, and a video whose title does not contain the track name at all is usually
  // one of those. A penalty rather than a rejection: abbreviations and translated titles are real.
  const titleMatches = normalizeText(candidate.title).includes(normalizeText(track.title));
  if (!titleMatches) {
    score -= TITLE_MISMATCH_PENALTY;
    notes.push('Video title doesn’t mention the track name');
  }

  const artist = normalizeText(track.artist);
  if (tier !== 'topic' && artist.length > 0 && normalizeText(candidate.channelTitle).includes(artist)) {
    score += ARTIST_CHANNEL_BONUS;
  }

  /*
   * The feedback loop. Everything above this point is inference from metadata; this is the record
   * of what happened when people actually played the video, so it comes last and it wins.
   *
   * The demotion case is the one the design cares about most: submissions that disagree by seconds
   * are not imprecise measurements of one recording, they are precise measurements of several. A
   * video like that can never be fixed by an offset, however many people try, so it is rejected
   * outright and the next candidate is promoted into its place.
   */
  const consensus = signals.get(candidate.videoId);
  if (consensus) {
    if (isWrongVideoSignal(consensus)) {
      rejected = true;
      rejectionReason = `Players' timings for this video disagree by seconds — it is probably a different recording`;
    } else if (consensus.confidence === 'confirmed') {
      score += CONFIRMED_OFFSET_BONUS;
      notes.push(`Timing confirmed by ${consensus.submissionCount} players`);
    } else if (consensus.confidence === 'provisional') {
      score += PROVISIONAL_OFFSET_BONUS;
      notes.push('Timed by one player — provisional');
    }
  }

  return {
    ...candidate,
    tier,
    score: Math.round(score * 10) / 10,
    durationDeltaSec,
    rejected,
    ...(rejectionReason ? { rejectionReason } : {}),
    notes,
  };
}

function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * Ranks candidates best-first.
 *
 * Rejected candidates are kept and sorted to the end rather than dropped. Every rejection here is
 * a heuristic firing on a title string, and heuristics are wrong sometimes — a track whose only
 * upload is on a channel we cannot identify should still be playable, with the reason shown, by a
 * user who can see the video and judge for themselves.
 */
export function rankCandidates(
  candidates: VideoCandidate[],
  track: TrackForRanking,
  signals: OffsetSignals = new Map(),
): RankedCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, track, signals))
    .sort((a, b) => {
      if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break on the smaller excess: same tier, same penalties, take the tighter fit. An
      // unknown delta sorts as if it were exact, since there is nothing to hold against it.
      return Math.abs(a.durationDeltaSec ?? 0) - Math.abs(b.durationDeltaSec ?? 0);
    });
}
