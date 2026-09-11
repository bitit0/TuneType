import type { VideoCandidate, VideoSearchResponse } from '@shared/types';
import { readCache, writeCache } from './cache.js';
import { getConsensusMap } from '../offsets/store.js';
import { canSearch, quotaStatus, recordSearch } from './quota.js';
import { parseIsoDuration, rankCandidates, searchCacheKey, type TrackForRanking } from './rank.js';

/**
 * The YouTube Data API v3 client.
 *
 * This module is the only place the API key is used, and the key never leaves the server — that is
 * the whole reason an Express process exists in a project whose other network calls go straight
 * from the browser.
 *
 * Two calls make one search: `search.list` (100 quota units) returns ids and titles but no
 * duration, and `videos.list` (1 unit) fills in the durations that the ranking needs. The second
 * call is effectively free, so it is always made rather than trying to rank on titles alone.
 */

const API = 'https://www.googleapis.com/youtube/v3';

/** Ten is enough to contain a Topic upload if one exists, and costs the same as one. */
const MAX_RESULTS = 10;

export class YouTubeUnavailableError extends Error {}
export class QuotaExceededError extends Error {}

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new YouTubeUnavailableError('YouTube search is not configured on this server.');
  return key;
}

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

interface VideoItem {
  id?: string;
  snippet?: { title?: string; channelTitle?: string };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean };
}

/**
 * Turns Google's error envelope into something that names the actual setup problem.
 *
 * Every one of these arrives as a 403 with a JSON body, and the difference between "you are out of
 * quota" and "you never enabled the API" is one string deep inside it. Left unread they are the
 * same opaque failure, and they need completely different fixes.
 */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: {
      message?: string;
      errors?: Array<{ reason?: string }>;
      details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
    };
  } | null;

  /*
   * Google reports the same failure in two shapes and which one arrives is not predictable.
   *
   * The legacy shape carries `errors[0].reason` ("accessNotConfigured"). The newer google.rpc
   * shape has no `errors` array at all — the cause lives in `details[].reason`
   * ("SERVICE_DISABLED") and the top-level message is the unhelpful "Requests to this API ... are
   * blocked". Reading only the first shape meant the very first real error this code ever saw fell
   * through to that raw string, which names a service path rather than the one console click that
   * fixes it.
   */
  const detail = body?.error?.details?.find((entry) => typeof entry?.reason === 'string');
  const reason = body?.error?.errors?.[0]?.reason ?? detail?.reason;

  // The project the key belongs to, when Google says. Worth repeating back: a key from the wrong
  // project fails exactly like an API that was never switched on.
  const project = detail?.metadata?.['containerInfo'] ?? detail?.metadata?.['consumer'];

  switch (reason) {
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
      return 'The YouTube API key is out of quota for today. It resets at midnight Pacific.';
    case 'accessNotConfigured':
    case 'SERVICE_DISABLED':
      return (
        'The YouTube Data API v3 is not enabled' +
        (project ? ` for Google Cloud project ${project}` : ' for this Google Cloud project') +
        '. Enable it at https://console.cloud.google.com/apis/library/youtube.googleapis.com then ' +
        'wait a minute for it to propagate.'
      );
    case 'keyInvalid':
    case 'badRequest':
      return 'The YouTube API key was rejected. Check YOUTUBE_API_KEY in .env.';
    case 'ipRefererBlocked':
      return 'The YouTube API key has referrer or IP restrictions that block this server. An API key used server-side needs no HTTP-referrer restriction.';
    default:
      return body?.error?.message ?? `YouTube returned HTTP ${response.status}.`;
  }
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', apiKey());

  const response = await fetch(url);
  if (!response.ok) throw new YouTubeUnavailableError(await describeFailure(response));

  return (await response.json()) as T;
}

/**
 * Finds candidate videos for a track.
 *
 * `videoEmbeddable` and `videoSyndicated` are not optional niceties. A video the owner has blocked
 * from embedding loads as a black rectangle in the IFrame player, and the failure looks like our
 * bug rather than the uploader's choice. Filtering at the source costs nothing and removes a
 * category of result that could never have been played.
 */
async function searchYouTube(track: TrackForRanking): Promise<VideoCandidate[]> {
  // Deliberately not filtered to `videoCategoryId: 10` (Music). Topic uploads are categorised as
  // Music reliably, but the independent lyric-video channels — tier three, and often the only
  // usable upload for a track — routinely file under Entertainment or People & Blogs. Narrowing
  // the one search we are allowed to make would hide those, and the query already carries the
  // artist name, which is what actually keeps unrelated results out.
  const found = await call<{ items?: SearchItem[] }>('search', {
    part: 'snippet',
    type: 'video',
    q: `${track.artist} ${track.title}`,
    maxResults: String(MAX_RESULTS),
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
  });

  await recordSearch();

  const ids = (found.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  // One unit, and the only source of duration — which the entire ranking heuristic turns on.
  const details = await call<{ items?: VideoItem[] }>('videos', {
    part: 'snippet,contentDetails,status',
    id: ids.join(','),
  });

  const candidates: VideoCandidate[] = [];

  for (const item of details.items ?? []) {
    const videoId = item.id;
    const durationSec = parseIsoDuration(item.contentDetails?.duration ?? '');

    // `status.embeddable` is checked again here because the search filter has been observed to let
    // the occasional non-embeddable result through, and a duration we cannot parse means we cannot
    // rank it — both make the candidate unusable rather than merely unattractive.
    if (!videoId || durationSec === null || item.status?.embeddable === false) continue;

    candidates.push({
      videoId,
      title: item.snippet?.title ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
      durationSec,
    });
  }

  // `videos.list` does not preserve the order ids were given in, but ranking replaces it anyway.
  return candidates;
}

/**
 * Ranked candidates for a track, from cache when possible.
 *
 * The budget check sits between the cache lookup and the network call on purpose: a cached track
 * stays playable after the day's budget is gone, which is what keeps the feature from falling over
 * entirely once someone has run through the quota.
 */
export async function findVideos(
  track: TrackForRanking,
  options: { cachedOnly?: boolean; lrclibId?: number } = {},
): Promise<VideoSearchResponse> {
  const key = searchCacheKey(track);

  /**
   * Offset evidence for these specific candidates, when the caller told us which LRCLIB entry it
   * is choosing a video for. Ranking works without it — this is a refinement over the metadata
   * heuristics, not a dependency of them — so a failure to read it must not take search down.
   */
  const signalsFor = async (candidates: VideoCandidate[]) => {
    if (options.lrclibId === undefined || candidates.length === 0) return new Map();
    try {
      return await getConsensusMap(
        candidates.map((candidate) => candidate.videoId),
        options.lrclibId,
      );
    } catch (error) {
      console.warn('[youtube] Could not read offset signals for ranking:', error);
      return new Map();
    }
  };

  const cached = await readCache(key);
  if (cached) {
    return {
      candidates: rankCandidates(cached, track, await signalsFor(cached)),
      cached: true,
      quota: await quotaStatus(),
    };
  }

  if (!isYouTubeConfigured()) {
    throw new YouTubeUnavailableError('YouTube search is not configured on this server.');
  }

  /*
   * A cache-only request is how the video screen loads without spending anything. Opening that
   * screen is not the same act as asking to search — a user who picked the wrong track and went
   * back should not have cost the server 100 of its 10,000 daily units to do it. Tracks someone
   * has already looked up appear instantly and free; everything else asks first.
   */
  if (options.cachedOnly) {
    return { candidates: [], cached: false, needsSearch: true, quota: await quotaStatus() };
  }

  if (!(await canSearch())) {
    const { used, budget } = await quotaStatus();
    throw new QuotaExceededError(
      `Today's YouTube search budget is spent (${used} of ${budget}). It resets at midnight Pacific — paste a video link in the meantime.`,
    );
  }

  const candidates = await searchYouTube(track);

  // An empty result is cached too. "There is nothing on YouTube for this" is a real answer, and
  // re-asking costs the same 100 units as asking the first time.
  await writeCache(key, candidates);

  return {
    candidates: rankCandidates(candidates, track, await signalsFor(candidates)),
    cached: false,
    quota: await quotaStatus(),
  };
}
