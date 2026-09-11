import { Router } from 'express';
import { z } from 'zod';
import {
  findVideos,
  findVideosByQuery,
  isYouTubeConfigured,
  QuotaExceededError,
  YouTubeUnavailableError,
} from '../youtube/api.js';
import { quotaStatus } from '../youtube/quota.js';
import { searchLimiter } from '../middleware/limits.js';

/**
 * Video search.
 *
 * Open to guests: picking a video is part of starting a song, and nothing in the account layer is
 * allowed to become a prerequisite for playing. `optionalAuth` has still run, so when consensus
 * offsets land there is already an identity here to attribute a submission to.
 *
 * Every failure on this route is designed to be survivable. The client keeps the paste-a-link form
 * regardless of what happens here — search is a convenience over a flow that already worked.
 */

export const youtubeRouter = Router();

const searchQuerySchema = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  /**
   * LRCLIB's duration, in seconds. Optional because a fair number of entries carry none, and
   * `.nullable()` is not enough on its own — an absent query parameter arrives as undefined.
   */
  durationSec: z.coerce.number().positive().max(24 * 60 * 60).optional(),
  /** Answer from the cache or not at all. The video screen's first load uses this. */
  cachedOnly: z.enum(['true', '1']).optional(),
  /**
   * Which LRCLIB entry the caller is picking a video for.
   *
   * Optional because ranking works without it, and required for none of the metadata heuristics.
   * What it unlocks is the offset store's evidence: offsets are keyed to a video *and* a track, so
   * without knowing the track there is no way to ask whether players have successfully timed
   * these candidates.
   */
  lrclibId: z.coerce.number().int().nonnegative().optional(),
});

// The tighter limit goes on the two routes that can spend a search, not on the router: /status is
// a free read and the client calls it on every visit to the home page.
youtubeRouter.get('/search', searchLimiter, async (req, res) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'A title and artist are required to search.' });
    return;
  }

  const { title, artist, durationSec, cachedOnly, lrclibId } = parsed.data;

  try {
    res.json(
      await findVideos(
        { title, artist, durationSec: durationSec ?? null },
        { cachedOnly: cachedOnly !== undefined, lrclibId },
      ),
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // 429, not 503: the difference between "come back later" and "this server cannot do that at
      // all" is the difference between showing a countdown and hiding the feature.
      res.status(429).json({ error: error.message, quota: await quotaStatus() });
      return;
    }

    if (error instanceof YouTubeUnavailableError) {
      // 503 is what the client already treats as "not configured" — the same shrug the account
      // routes get when there is no Firebase project.
      res.status(503).json({ error: error.message });
      return;
    }

    console.error('[youtube]', error);
    res.status(502).json({ error: 'Could not reach YouTube. Paste a video link instead.' });
  }
});

const videoQuerySchema = z.object({ q: z.string().trim().min(1).max(300) });

/**
 * Free-text video search — the video-first way into a song.
 *
 * Unlike `/search` there is no cache-only mode. That mode exists so that opening the video screen
 * costs nothing, and a typed query has no equivalent: it only arrives because someone asked for it.
 */
youtubeRouter.get('/videos', searchLimiter, async (req, res) => {
  const parsed = videoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Type something to search for.' });
    return;
  }

  try {
    res.json(await findVideosByQuery(parsed.data.q));
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      res.status(429).json({ error: error.message, quota: await quotaStatus() });
      return;
    }

    if (error instanceof YouTubeUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }

    console.error('[youtube]', error);
    res.status(502).json({ error: 'Could not reach YouTube. Paste a video link instead.' });
  }
});

/** Lets the client decide whether to offer search at all, before a user commits to a track. */
youtubeRouter.get('/status', async (_req, res) => {
  res.json({ configured: isYouTubeConfigured(), quota: await quotaStatus() });
});
