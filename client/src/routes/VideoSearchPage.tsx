import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Image,
  Input,
  Link as ChakraLink,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { VideoCandidate } from '@shared/types';
import { fetchYouTubeStatus, isQuotaExceeded, searchVideosByQuery } from '@/lib/api/youtube';
import { isUnavailable } from '@/lib/api/client';
import { thumbnailUrl } from '@/lib/api/setlists';
import { resolveTrackForVideo } from '@/lib/lrclib/match';
import { LrclibError } from '@/lib/lrclib/client';
import { useSessionStore } from '@/store/sessionStore';

/**
 * The front door: find the video, and the lyrics follow.
 *
 * This is the reverse of the flow behind `/songs`, and the two are not redundant. Searching for a
 * video is how someone actually thinks about a song — they know what they want to hear, not which
 * of five LRCLIB entries describes it. But it needs an API key and spends the scarcest thing this
 * app has, so the lyrics-first search stays as the path that always works.
 */

type Status = 'idle' | 'loading' | 'done' | 'error';

/**
 * Animation offsets for the equalizer bars.
 *
 * Fixed values rather than random ones so every render draws the identical wave — a random pattern
 * would reshuffle on each React pass and make the bars jump.
 */
const EQ_BARS = [0, 0.42, 0.15, 0.68, 0.3, 0.9, 0.05, 0.55, 0.24, 0.78, 0.38, 0.12, 0.62, 0.48, 0.2];

/** Four real searches, so the empty state has somewhere to go. */
const SUGGESTIONS = ['Fleetwood Mac Dreams', 'a-ha Take On Me', 'Radiohead Creep', 'ABBA Waterloo'];

const STEPS = [
  {
    title: 'Search the video',
    body: 'Results come from YouTube, filtered to what can actually be embedded and played.',
  },
  {
    title: 'Lyrics match themselves',
    body: 'Its title says which song, its length says which cut. No picking through LRCLIB entries.',
  },
  {
    title: 'Type in time',
    body: 'Lines scroll with the music. Accuracy is the base; landing a line inside its window pays the rest.',
  },
];

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** The one line offering the other flow, wherever this one runs out of road. */
function ManualFallback({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="sm" color="var(--tt-muted)" mt={2}>
      {children}{' '}
      <ChakraLink asChild color="var(--tt-accent)">
        <Link to="/songs">Search by song instead</Link>
      </ChakraLink>
      .
    </Text>
  );
}

export function VideoSearchPage() {
  const navigate = useNavigate();
  const beginRun = useSessionStore((s) => s.beginRun);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoCandidate[]>([]);

  /** Which video is having its lyrics looked up, so only that row shows a spinner. */
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  /**
   * Whether this server can search videos at all, or null until it has answered.
   *
   * Rendered optimistically while null. A configured server is the ordinary case and should not
   * wait on a round trip to show its search box; an unconfigured one hands over to the
   * lyrics-first flow, which is the whole front door when there is no API key.
   */
  const [configured, setConfigured] = useState<boolean | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchYouTubeStatus(controller.signal)
      .then((status) => setConfigured(status.configured))
      .catch((error: unknown) => {
        // Nothing answering at that path means there is no server at all — a static deployment.
        // Handing over to the song-first flow beats offering a search box that cannot work.
        // Any other failure says nothing about the key, so assume the usual case and let a real
        // search produce a real error message.
        setConfigured(isUnavailable(error) ? false : null);
      });
    return () => controller.abort();
  }, []);

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    void search(query);
  }

  /** Takes the text rather than reading state, so a suggestion can search itself on the same tick. */
  async function search(text: string) {
    if (!text.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    setResolveError(null);

    try {
      const result = await searchVideosByQuery(text, controller.signal);
      setVideos(result.videos);
      setStatus('done');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;

      setStatus('error');
      if (isUnavailable(err)) {
        setError('Video search is not configured on this server.');
      } else if (isQuotaExceeded(err)) {
        setError((err as Error).message);
      } else {
        setError('Could not search YouTube just now.');
      }
    }
  }

  /**
   * Picking a video is the whole choice — the lyrics are worked out from its title and length.
   *
   * A miss here is ordinary rather than exceptional: plenty of uploads are titled in a way nothing
   * can be read out of, and plenty of songs have no synced lyrics anywhere. Either way the answer
   * is the manual search rather than an apology.
   */
  async function choose(video: VideoCandidate) {
    if (resolving !== null) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResolving(video.videoId);
    setResolveError(null);

    try {
      const track = await resolveTrackForVideo(video, controller.signal);

      if (!track) {
        setResolveError(`No synced lyrics on LRCLIB match "${video.title}".`);
        return;
      }

      beginRun(track, video.videoId);
      navigate('/play');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResolveError(
        err instanceof LrclibError ? err.message : 'Could not look up lyrics for that video.',
      );
    } finally {
      setResolving(null);
    }
  }

  if (configured === false) return <Navigate to="/songs" replace />;

  // The hero stands down once there is something to look at. Results are the reason the page
  // exists, and a full-height introduction above them would push them off the fold.
  const idle = videos.length === 0 && status !== 'done';

  return (
    <>
      <Box className="tt-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </Box>

      <Stack gap={idle ? 10 : 6} position="relative" zIndex={1}>
        <Stack gap={idle ? 6 : 3} align="center" textAlign="center" pt={idle ? { base: 4, md: 10 } : 0}>
          {idle && (
            <Flex className="tt-eq" aria-hidden="true">
              {EQ_BARS.map((delay, i) => (
                <Box as="i" key={i} style={{ animationDelay: `${delay}s` }} />
              ))}
            </Flex>
          )}

          <Heading
            size={idle ? { base: '2xl', md: '4xl' } : 'lg'}
            letterSpacing="tight"
            lineHeight="1.1"
          >
            <Box as="span" className={idle ? 'tt-typed' : undefined}>
              Type what you hear
            </Box>
            {idle && <Box as="span" className="tt-caret" ms={1} />}
          </Heading>

          {idle && (
            <Text color="var(--tt-muted)" maxW="lg" fontSize={{ base: 'md', md: 'lg' }}>
              Find the video. The lyrics are matched to it automatically, by title and by length,
              and scroll in time while you type.
            </Text>
          )}
        </Stack>

        {/* The focal point. Everything above is sized around it, not the other way round. */}
        <Box w="100%" maxW="2xl" mx="auto">
          <form onSubmit={runSearch}>
            <Box className="tt-search-glow">
              <Flex
                gap={2}
                p={2}
                bg="var(--tt-surface)"
                borderWidth="1px"
                borderColor="var(--tt-border)"
                align="center"
              >
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Artist and song"
                  size="lg"
                  variant="subtle"
                  bg="transparent"
                  border="none"
                  fontSize={{ base: 'md', md: 'lg' }}
                  _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                  autoFocus
                />
                <Button
                  type="submit"
                  size="lg"
                  colorPalette="blue"
                  px={7}
                  disabled={status === 'loading'}
                  flexShrink={0}
                >
                  Search
                </Button>
              </Flex>
            </Box>
          </form>

          {/* Somewhere to start. An empty search box is a worse prompt than four real songs. */}
          {idle && (
            <Flex gap={2} wrap="wrap" justify="center" mt={4}>
              <Text fontSize="sm" color="var(--tt-muted)" alignSelf="center" me={1}>
                Try
              </Text>
              {SUGGESTIONS.map((suggestion) => (
                <Box
                  as="button"
                  key={suggestion}
                  onClick={() => {
                    setQuery(suggestion);
                    void search(suggestion);
                  }}
                  fontSize="sm"
                  px={3}
                  py={1}
                  borderWidth="1px"
                  borderColor="var(--tt-border)"
                  bg="var(--tt-surface)"
                  color="var(--tt-muted)"
                  _hover={{ color: 'var(--tt-text)', borderColor: 'var(--tt-accent)' }}
                >
                  {suggestion}
                </Box>
              ))}
            </Flex>
          )}
        </Box>

        {idle && (
          <Grid templateColumns={{ base: '1fr', md: 'repeat(3, 1fr)' }} gap={4} maxW="4xl" mx="auto">
            {STEPS.map((step, i) => (
              <Box
                key={step.title}
                borderWidth="1px"
                borderColor="var(--tt-border)"
                borderRadius="lg"
                bg="var(--tt-surface)"
                p={5}
              >
                <Text fontSize="xs" color="var(--tt-accent)" fontWeight="bold" letterSpacing="wider">
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text fontWeight="semibold" mt={1} mb={1}>
                  {step.title}
                </Text>
                <Text fontSize="sm" color="var(--tt-muted)" lineHeight="1.6">
                  {step.body}
                </Text>
              </Box>
            ))}
          </Grid>
        )}

      {status === 'loading' && (
        <Flex align="center" gap={3} color="var(--tt-muted)">
          <Spinner size="sm" /> <Text>Searching YouTube…</Text>
        </Flex>
      )}

      {status === 'error' && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{error}</Text>
          <ManualFallback>Nothing here is lost.</ManualFallback>
        </Box>
      )}

      {resolveError && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
          <Text>{resolveError}</Text>
          <ManualFallback>Pick the words yourself and then choose a video for them.</ManualFallback>
        </Box>
      )}

      {status === 'done' && videos.length === 0 && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
          <Text>YouTube returned nothing playable for that.</Text>
          <Text fontSize="sm" color="var(--tt-muted)" mt={1}>
            Results that cannot be embedded are filtered out at the source, so a video that exists
            may still not appear here.
          </Text>
        </Box>
      )}

      {videos.length > 0 && (
        <Stack gap={2}>
          {videos.map((video) => (
            <Flex
              key={video.videoId}
              as="button"
              onClick={() => void choose(video)}
              // Dimmed rather than disabled while another row resolves: Chakra's Flex is a div
              // with a button role, so the guard that actually stops a second lookup is in choose.
              opacity={resolving === null || resolving === video.videoId ? 1 : 0.5}
              align="center"
              gap={4}
              textAlign="left"
              w="100%"
              p={3}
              borderWidth="1px"
              borderColor="var(--tt-border)"
              borderRadius="md"
              bg="var(--tt-surface)"
              _hover={{ borderColor: 'var(--tt-accent)' }}
            >
              <Image
                src={thumbnailUrl(video.videoId)}
                alt=""
                w="120px"
                h="68px"
                objectFit="cover"
                borderRadius="sm"
                flexShrink={0}
              />
              <Box minW={0} flex="1">
                <Text fontWeight="semibold" truncate>
                  {video.title}
                </Text>
                <Text fontSize="sm" color="var(--tt-muted)" truncate>
                  {video.channelTitle} · {formatDuration(video.durationSec)}
                </Text>
              </Box>
              {resolving === video.videoId && <Spinner size="sm" flexShrink={0} />}
            </Flex>
          ))}
        </Stack>
      )}

        {!idle && (
          <Text fontSize="sm" color="var(--tt-muted)">
            Uploads from "Artist - Topic" channels are the distributor's own master and need the
            least timing correction. Official music videos are the worst bet — spoken intros and
            edited arrangements both break the sync.
          </Text>
        )}
      </Stack>
    </>
  );
}
