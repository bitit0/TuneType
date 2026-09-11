import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findVideos, QuotaExceededError, YouTubeUnavailableError } from './api.js';
import { __clearMemoryCache } from './cache.js';
import { __resetQuota, quotaDay } from './quota.js';
import type { TrackForRanking } from './rank.js';

/**
 * These tests are about quota, not about YouTube. `fetch` is stubbed, so what is under test is the
 * thing that actually matters here: that a day's worth of searching cannot be spent by accident.
 *
 * No Firebase project is involved — `getFirestore()` returns null without credentials, so the
 * cache and the counter run purely in memory, which is exactly the configuration a fresh clone
 * has.
 */

const TRACK: TrackForRanking = { title: 'Paper Kites', artist: 'Halcyon Bay', durationSec: 233 };

function searchResponse(ids: string[]) {
  return { items: ids.map((id) => ({ id: { videoId: id } })) };
}

function videosResponse(
  items: Array<{ id: string; title?: string; channel?: string; duration?: string; embeddable?: boolean }>,
) {
  return {
    items: items.map((item) => ({
      id: item.id,
      snippet: { title: item.title ?? 'Paper Kites', channelTitle: item.channel ?? 'Halcyon Bay - Topic' },
      contentDetails: { duration: item.duration ?? 'PT3M53S' },
      status: { embeddable: item.embeddable ?? true },
    })),
  };
}

/**
 * Serves the given payloads in order, repeating the last one. Each `findVideos` miss makes two
 * calls — `search.list` then `videos.list` — so a pair of pages covers one search, and repeating
 * the last page lets a test make several searches against the same fixture.
 */
function stubFetch(...pages: unknown[]) {
  let call = 0;

  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => pages[Math.min(call++, pages.length - 1)],
  }));

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => {
  __clearMemoryCache();
  __resetQuota();
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
  vi.stubEnv('YOUTUBE_SEARCH_DAILY_BUDGET', '2');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('findVideos', () => {
  it('spends one search on a miss and none on a hit', async () => {
    const fetchMock = stubFetch(
      searchResponse(['vid1']),
      videosResponse([{ id: 'vid1' }]),
    );

    const first = await findVideos(TRACK);
    expect(first.cached).toBe(false);
    expect(first.quota.used).toBe(1);
    expect(first.candidates[0]?.videoId).toBe('vid1');
    expect(fetchMock).toHaveBeenCalledTimes(2); // search.list + videos.list

    // The same recording arriving as a different LRCLIB entry — different id, album and duration.
    // This is the case the cache exists for, and it must not cost another 100 units.
    const second = await findVideos({ title: 'PAPER KITES', artist: 'Halcyon Bay', durationSec: 235 });
    expect(second.cached).toBe(true);
    expect(second.quota.used).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to search once the daily budget is spent', async () => {
    stubFetch(searchResponse(['vid1']), videosResponse([{ id: 'vid1' }]));

    await findVideos({ ...TRACK, title: 'One' });
    await findVideos({ ...TRACK, title: 'Two' });

    await expect(findVideos({ ...TRACK, title: 'Three' })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('still answers from cache after the budget is spent', async () => {
    // The point of checking the budget after the cache lookup rather than before it: running out
    // of quota degrades the feature to "tracks someone has already looked up", not to nothing.
    stubFetch(searchResponse(['vid1']), videosResponse([{ id: 'vid1' }]));

    await findVideos({ ...TRACK, title: 'One' });
    await findVideos({ ...TRACK, title: 'Two' });

    const cached = await findVideos({ ...TRACK, title: 'One' });
    expect(cached.cached).toBe(true);
    expect(cached.candidates).toHaveLength(1);
  });

  it('drops results that could never be played', async () => {
    stubFetch(
      searchResponse(['ok', 'blocked', 'unparseable']),
      videosResponse([
        { id: 'ok' },
        { id: 'blocked', embeddable: false },
        { id: 'unparseable', duration: 'nonsense' },
      ]),
    );

    const { candidates } = await findVideos(TRACK);
    expect(candidates.map((c) => c.videoId)).toEqual(['ok']);
  });

  it('caches an empty result rather than re-asking for it', async () => {
    stubFetch(searchResponse([]));

    const first = await findVideos(TRACK);
    expect(first.candidates).toHaveLength(0);
    expect(first.quota.used).toBe(1);

    const second = await findVideos(TRACK);
    expect(second.cached).toBe(true);
    expect(second.quota.used).toBe(1);
  });

  it('reports a missing key as unavailable rather than failing mid-request', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');
    await expect(findVideos(TRACK)).rejects.toBeInstanceOf(YouTubeUnavailableError);
  });

  it('names the failure when the API is disabled in the newer error shape', async () => {
    /*
     * This is the shape a real disabled project returns, and it caught the code out: no `errors`
     * array, so the cause is only in `details[].reason`, and the top-level message says
     * "Requests to this API youtube method ... are blocked" — which names a service path instead
     * of the console switch that fixes it.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            message: 'Requests to this API youtube method youtube.api.v3.V3DataSearchService.List are blocked.',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'SERVICE_DISABLED',
                metadata: { containerInfo: '608595456700', serviceTitle: 'YouTube Data API v3' },
              },
            ],
          },
        }),
      })) as unknown as typeof fetch,
    );

    await expect(findVideos(TRACK)).rejects.toThrow(/not enabled.*608595456700/is);
  });

  it('names the failure when Google refuses the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { errors: [{ reason: 'accessNotConfigured' }] } }),
      })) as unknown as typeof fetch,
    );

    await expect(findVideos(TRACK)).rejects.toThrow(/not enabled/i);
  });
});

describe('quotaDay', () => {
  it('rolls over on Pacific midnight, not on the local one', () => {
    // 08:30 UTC on 1 March is still 00:30 Pacific on 1 March — the same quota day. An hour earlier
    // it is still February, and a counter keyed on UTC would have reset already.
    expect(quotaDay(new Date('2026-03-01T08:30:00Z'))).toBe('2026-03-01');
    expect(quotaDay(new Date('2026-03-01T07:30:00Z'))).toBe('2026-02-28');
  });
});
