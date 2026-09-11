import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Flex, Heading, Input, List, Spinner, Stack, Text } from '@chakra-ui/react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { ChannelTier, PlayableTrack, RankedCandidate } from '@shared/types';
import { isQuotaExceeded, searchVideos } from '@/lib/api/youtube';
import { isUnavailable } from '@/lib/api/client';
import { parseVideoId } from '@/lib/youtube/parseVideoId';
import { useSessionStore } from '@/store/sessionStore';

/**
 * Choosing a video.
 *
 * Two ways in, and the order matters. Search ranks candidates server-side and is the fast path;
 * pasting a link is the one that always works — with no API key, with the day's quota spent, and
 * for the track whose only good upload the ranking got wrong. Neither is a fallback for the other
 * in the sense of being second-class: the paste form is always visible.
 */

/** How each tier is labelled and why it is where it is. The ranking, made legible. */
const TIER: Record<ChannelTier, { label: string; hint: string; palette: string }> = {
  topic: {
    label: 'Topic',
    hint: 'Auto-generated from the distributor’s master — usually needs no timing correction',
    palette: 'green',
  },
  official: {
    label: 'Official audio',
    hint: 'From the artist’s own channel — normally the same master',
    palette: 'teal',
  },
  lyric: {
    label: 'Lyric video',
    hint: 'Right audio, but often a few seconds of title card first',
    palette: 'blue',
  },
  musicvideo: {
    label: 'Music video',
    hint: 'Last resort — spoken intros and edited arrangements break the timing',
    palette: 'orange',
  },
  other: { label: 'Unidentified', hint: 'Could be anything — check it before playing', palette: 'gray' },
};

/**
 * Tiers trusted enough to open without asking.
 *
 * Both are normally the distributor's own master, so the video starts where the lyrics do. Lyric
 * videos are excluded despite ranking above music videos, because their title cards mean the
 * first thing an auto-opened run would do is play several seconds of silence at the player.
 */
const AUTO_OPEN_TIERS = new Set<ChannelTier>(['topic', 'official']);

/**
 * Tracks already auto-opened during this page load.
 *
 * Backing out of a song has to land on the list of candidates, not throw the player straight back
 * into the one they just left. Module scope rather than a ref because the guard has to survive
 * this component unmounting, which is exactly what going to the play screen does.
 */
const autoOpened = new Set<number>();

function formatDelta(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds === 0) return 'exact length';
  const sign = seconds > 0 ? '+' : '−';
  const whole = Math.abs(Math.round(seconds));
  if (whole < 60) return `${sign}${whole}s`;
  return `${sign}${Math.floor(whole / 60)}m ${whole % 60}s`;
}

type Phase = 'loading' | 'ready' | 'needsSearch' | 'searching' | 'unavailable' | 'error';

export function SelectVideoPage() {
  const navigate = useNavigate();
  const track = useSessionStore((s) => s.track);
  const beginRun = useSessionStore((s) => s.beginRun);

  const [phase, setPhase] = useState<Phase>('loading');
  const [candidates, setCandidates] = useState<RankedCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  const [input, setInput] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (chosen: PlayableTrack, cachedOnly: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase(cachedOnly ? 'loading' : 'searching');
      setMessage(null);

      try {
        const result = await searchVideos(chosen, { cachedOnly, signal: controller.signal });

        if (result.needsSearch) {
          setPhase('needsSearch');
          setMessage(
            `${result.quota.budget - result.quota.used} of ${result.quota.budget} searches left today.`,
          );
          return;
        }

        setCandidates(result.candidates);
        setPhase('ready');

        // One confident match is not a choice worth making by hand. Everything else — a lyric
        // video, a music video, nothing but rejects — still gets the list.
        const best = result.candidates.find((candidate) => !candidate.rejected);
        if (best && AUTO_OPEN_TIERS.has(best.tier) && !autoOpened.has(chosen.lrclibId)) {
          autoOpened.add(chosen.lrclibId);
          beginRun(chosen, best.videoId);
          navigate('/play');
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;

        // No API key is not a failure state — it is a server that was never set up for search, and
        // the paste form below covers it completely. Say so once, quietly, and get out of the way.
        if (isUnavailable(error)) {
          setPhase('unavailable');
          return;
        }

        setPhase('error');
        setMessage(
          isQuotaExceeded(error)
            ? (error as Error).message
            : 'Could not search YouTube just now. Paste a link instead.',
        );
      }
    },
    [beginRun, navigate],
  );

  useEffect(() => {
    if (!track) return;
    void load(track, true);
    return () => abortRef.current?.abort();
  }, [track, load]);

  if (!track) return <Navigate to="/" replace />;

  function play(videoId: string) {
    beginRun(track!, videoId);
    navigate('/play');
  }

  function submitPaste(event: React.FormEvent) {
    event.preventDefault();
    const videoId = parseVideoId(input);

    if (!videoId) {
      setPasteError('That does not look like a YouTube link or video ID.');
      return;
    }

    play(videoId);
  }

  const playable = candidates.filter((c) => !c.rejected);
  const rejected = candidates.filter((c) => c.rejected);

  return (
    <Stack gap={6} maxW="3xl">
      <Box>
        <Heading size="lg" mb={1}>
          Pick a video
        </Heading>
        <Text color="var(--tt-muted)">
          {track.artist} — {track.title}
        </Text>
      </Box>

      {phase === 'loading' && (
        <Flex align="center" gap={3} color="var(--tt-muted)">
          <Spinner size="sm" /> <Text>Checking for known videos…</Text>
        </Flex>
      )}

      {phase === 'searching' && (
        <Flex align="center" gap={3} color="var(--tt-muted)">
          <Spinner size="sm" /> <Text>Searching YouTube…</Text>
        </Flex>
      )}

      {/*
        The ask-first state. Opening this screen costs nothing; a search costs one of about a
        hundred the whole server gets per day, so it is a button rather than something that just
        happens. Tracks anyone has already looked up skip this entirely.
      */}
      {phase === 'needsSearch' && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
          <Heading size="sm" mb={2}>
            Search YouTube for this track
          </Heading>
          <Text fontSize="sm" color="var(--tt-muted)" mb={3}>
            Nobody has looked this one up yet. Searching ranks the results by how well they tend to
            sync — Topic uploads first, music videos last. {message}
          </Text>
          <Button size="sm" colorPalette="blue" onClick={() => void load(track, false)}>
            Search
          </Button>
        </Box>
      )}

      {phase === 'error' && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{message}</Text>
        </Box>
      )}

      {phase === 'ready' && playable.length === 0 && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
          <Heading size="sm" mb={2}>
            Nothing here syncs well
          </Heading>
          <Text fontSize="sm" color="var(--tt-muted)">
            {rejected.length > 0
              ? 'Every result looks like a live take, an edit or the wrong length. Show them below, or paste a link you trust.'
              : 'YouTube returned nothing playable for this track. Paste a link instead.'}
          </Text>
        </Box>
      )}

      {playable.length > 0 && (
        <Stack gap={2}>
          {playable.map((candidate) => (
            <CandidateRow key={candidate.videoId} candidate={candidate} onPlay={play} />
          ))}
        </Stack>
      )}

      {/*
        Rejections are heuristics firing on a title string, and heuristics are wrong sometimes. The
        user can see the video and we cannot, so they stay reachable behind one click with the
        reason attached.
      */}
      {rejected.length > 0 && (
        <Box>
          <Button size="xs" variant="ghost" onClick={() => setShowRejected((v) => !v)}>
            {showRejected ? 'Hide' : `Show ${rejected.length} filtered out`}
          </Button>
          {showRejected && (
            <Stack gap={2} mt={2} opacity={0.7}>
              {rejected.map((candidate) => (
                <CandidateRow key={candidate.videoId} candidate={candidate} onPlay={play} />
              ))}
            </Stack>
          )}
        </Box>
      )}

      <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
        <Heading size="xs" mb={2}>
          {phase === 'unavailable' ? 'Paste a YouTube link' : 'Or paste a link'}
        </Heading>
        {phase === 'unavailable' && (
          <Text fontSize="sm" color="var(--tt-muted)" mb={3}>
            Search is not configured on this server, so pick the video yourself. “Artist - Topic”
            uploads sync best — they are the distributor’s own master, with no intro or edit.
          </Text>
        )}
        <form onSubmit={submitPaste}>
          <Flex gap={3}>
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setPasteError(null);
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              bg="var(--tt-surface)"
              borderColor="var(--tt-border)"
              autoFocus={phase === 'unavailable'}
            />
            <Button type="submit" colorPalette="blue">
              Play
            </Button>
          </Flex>
          {pasteError && (
            <Text color="var(--tt-wrong)" fontSize="sm" mt={2}>
              {pasteError}
            </Text>
          )}
        </form>
        {phase === 'unavailable' && (
          <List.Root fontSize="sm" color="var(--tt-muted)" gap={1} ps={4} mt={3}>
            <List.Item>Official artist channel audio or full-album uploads — normally the same master.</List.Item>
            <List.Item>Lyric videos — right audio, but often a few seconds of title card first.</List.Item>
            <List.Item>
              Official music videos — <strong>last resort</strong>. Spoken intros, label idents and
              edited arrangements all break the timing.
            </List.Item>
          </List.Root>
        )}
        <Text fontSize="sm" mt={3}>
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
              `${track.artist} ${track.title}`,
            )}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--tt-accent)' }}
          >
            Search YouTube yourself ↗
          </a>
        </Text>
      </Box>

      <Text fontSize="sm" color="var(--tt-muted)">
        If the lyrics run ahead or behind once playing, nudge them with the ← and → keys.
      </Text>
    </Stack>
  );
}

function CandidateRow({
  candidate,
  onPlay,
}: {
  candidate: RankedCandidate;
  onPlay: (videoId: string) => void;
}) {
  const tier = TIER[candidate.tier];

  return (
    <Flex
      as="button"
      onClick={() => onPlay(candidate.videoId)}
      align="center"
      justify="space-between"
      gap={4}
      textAlign="left"
      w="100%"
      p={4}
      borderWidth="1px"
      borderColor="var(--tt-border)"
      borderRadius="md"
      bg="var(--tt-surface)"
      _hover={{ borderColor: 'var(--tt-accent)' }}
    >
      <Box minW={0}>
        <Text fontWeight="semibold" truncate>
          {candidate.title}
        </Text>
        <Text fontSize="sm" color="var(--tt-muted)" truncate>
          {candidate.channelTitle}
        </Text>
        {candidate.rejectionReason ? (
          <Text fontSize="xs" color="var(--tt-wrong)" mt={1}>
            {candidate.rejectionReason}
          </Text>
        ) : (
          <Text fontSize="xs" color="var(--tt-muted)" mt={1}>
            {[tier.hint, ...candidate.notes].join(' · ')}
          </Text>
        )}
      </Box>
      <Flex align="center" gap={3} flexShrink={0}>
        <Text fontSize="sm" color="var(--tt-muted)">
          {formatDelta(candidate.durationDeltaSec)}
        </Text>
        <Badge colorPalette={tier.palette} variant="subtle">
          {tier.label}
        </Badge>
      </Flex>
    </Flex>
  );
}
