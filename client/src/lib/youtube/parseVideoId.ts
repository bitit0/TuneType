/**
 * Normalizes anything a user might paste into a bare YouTube video ID.
 *
 * Accepts a watch URL, a youtu.be short link, an /embed/ or /shorts/ path, or a bare ID. Extra
 * query params (`&t=`, `&list=`, tracking junk) are ignored.
 */

/** YouTube IDs are exactly 11 characters from a URL-safe alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const PATH_PREFIXES = ['/embed/', '/shorts/', '/v/', '/live/'];

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (VIDEO_ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Tolerate a pasted link with no scheme.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return VIDEO_ID.test(id) ? id : null;
  }

  const isYouTubeHost =
    host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com';
  if (!isYouTubeHost) return null;

  const queryId = url.searchParams.get('v');
  if (queryId && VIDEO_ID.test(queryId)) return queryId;

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const id = url.pathname.slice(prefix.length).split('/')[0] ?? '';
      return VIDEO_ID.test(id) ? id : null;
    }
  }

  return null;
}
