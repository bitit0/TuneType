import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import type { SetlistEntry, SetlistTier } from '@shared/types';
import { fetchSetlists, moveInSetlist, removeFromSetlist, thumbnailUrl } from '@/lib/api/setlists';
import { fetchTrackById, LrclibError } from '@/lib/lrclib/client';
import { BAND_PALETTE } from '@/components/Difficulty/PaceBadge';
import { CurateDialog } from '@/components/Setlists/CurateDialog';
import { useSessionStore } from '@/store/sessionStore';

/**
 * The curated setlists — the game's front door for anyone who does not already have a song in mind.
 *
 * Everything else here finds songs by search, which means taking whatever LRCLIB has and hoping
 * the video syncs. These are the ones somebody has already played and vouched for, sorted into
 * tiers so there is a place to start and a place to work towards.
 */

const TIERS: ReadonlyArray<{ tier: SetlistTier; label: string; blurb: string }> = [
  { tier: 'easy', label: 'Easy', blurb: 'Room to think between lines. Where to start.' },
  { tier: 'medium', label: 'Medium', blurb: 'A conversational pace, sustained.' },
  { tier: 'hard', label: 'Hard', blurb: 'Little slack. Mistakes start costing lines.' },
  { tier: 'insane', label: 'Insane', blurb: 'Dense, fast, and unforgiving.' },
  {
    tier: 'freestyle',
    label: 'Freestyle',
    blurb: 'Off the ladder — songs kept for their own sake rather than for where they rank.',
  },
];

/** The graded ladder. Freestyle is excluded, so the move controls cannot walk a song onto it. */
const LADDER = TIERS.filter((entry) => entry.tier !== 'freestyle');

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SetlistsPage() {
  const navigate = useNavigate();
  const beginRun = useSessionStore((s) => s.beginRun);

  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [canCurate, setCanCurate] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await fetchSetlists(controller.signal);
      setEntries(result.entries);
      setCanCurate(result.canCurate);
      setStatus('ready');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // No Firestore means no setlists, which is a server that was never set up for them rather
      // than a failure — same shrug the account screens give.
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  /**
   * Starts a run from a curated entry.
   *
   * The lyrics are not in the entry — they are fetched from LRCLIB here, in the browser, at the
   * moment of pressing play. A setlist stores a pointer to a song, never the song.
   */
  async function play(entry: SetlistEntry) {
    setLoadingId(entry.id);
    setError(null);

    try {
      const track = await fetchTrackById(entry.lrclibId);
      if (!track) {
        setError(
          `“${entry.title}” is no longer on LRCLIB — its lyrics entry was removed or merged. The curator will need to re-add it.`,
        );
        return;
      }

      beginRun(track, entry.videoId);
      navigate('/play');
    } catch (err) {
      setError(err instanceof LrclibError ? err.message : 'Could not load that song.');
    } finally {
      setLoadingId(null);
    }
  }

  if (status === 'loading') {
    return (
      <Flex align="center" gap={3} color="var(--tt-muted)">
        <Spinner size="sm" /> <Text>Loading setlists…</Text>
      </Flex>
    );
  }

  if (status === 'unavailable') {
    return (
      <Stack gap={3} maxW="2xl">
        <Heading size="lg">Setlists</Heading>
        <Text color="var(--tt-muted)">
          This server has no setlist storage configured, so there is nothing curated to show. Find a
          song by search instead — it works with no cloud setup at all.
        </Text>
        <Button alignSelf="flex-start" onClick={() => navigate('/')} colorPalette="blue">
          Find a song
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={8}>
      <Flex justify="space-between" align="flex-start" gap={4} wrap="wrap">
        <Box>
          <Heading size="lg" mb={1}>
            Setlists
          </Heading>
          <Text color="var(--tt-muted)" maxW="2xl">
            Songs picked by hand, with a video already known to sync, sorted by how hard they are to
            keep up with. Every other way into this game is a search and a gamble; this one is not.
          </Text>
        </Box>
        {canCurate && <CurateDialog onAdded={load} />}
      </Flex>

      {error && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{error}</Text>
        </Box>
      )}

      {TIERS.map(({ tier, label, blurb }) => {
        const songs = entries.filter((entry) => entry.tier === tier);

        return (
          <Box key={tier}>
            <Flex align="baseline" gap={3} mb={1}>
              <Heading size="md">{label}</Heading>
              <Badge colorPalette={BAND_PALETTE[tier]} variant="subtle">
                {songs.length}
              </Badge>
            </Flex>
            <Text fontSize="sm" color="var(--tt-muted)" mb={3}>
              {blurb}
            </Text>

            {songs.length === 0 ? (
              <Box
                borderWidth="1px"
                borderStyle="dashed"
                borderColor="var(--tt-border)"
                borderRadius="md"
                p={5}
              >
                <Text fontSize="sm" color="var(--tt-muted)">
                  {canCurate
                    ? 'Nothing here yet. Add a song with the button above.'
                    : 'Nothing here yet.'}
                </Text>
              </Box>
            ) : (
              <Stack gap={2}>
                {songs.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    canCurate={canCurate}
                    busy={loadingId === entry.id}
                    onPlay={() => void play(entry)}
                    onChanged={load}
                  />
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

function EntryCard({
  entry,
  canCurate,
  busy,
  onPlay,
  onChanged,
}: {
  entry: SetlistEntry;
  canCurate: boolean;
  busy: boolean;
  onPlay: () => void;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);

  async function move(tier: SetlistTier) {
    setWorking(true);
    try {
      await moveInSetlist(entry.id, tier);
      onChanged();
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    try {
      await removeFromSetlist(entry.id);
      onChanged();
    } finally {
      setWorking(false);
    }
  }

  const inFreestyle = entry.tier === 'freestyle';
  const rung = LADDER.findIndex((t) => t.tier === entry.tier);

  return (
    <Flex
      borderWidth="1px"
      borderColor="var(--tt-border)"
      borderRadius="md"
      bg="var(--tt-surface)"
      overflow="hidden"
      align="stretch"
      gap={0}
    >
      <Box
        as="button"
        // Guarded rather than `disabled`: a disabled button drops its hover and cursor affordances
        // for the fraction of a second the lyrics take to load, which reads as the click having
        // done nothing at all.
        onClick={() => {
          if (!busy) onPlay();
        }}
        aria-busy={busy}
        flex="1"
        textAlign="left"
        _hover={{ bg: 'var(--tt-border)' }}
        transition="background 120ms"
      >
        <Flex align="center" gap={4}>
          {/*
            Straight from i.ytimg.com — no API key, no quota. The fixed box with an object-fit crop
            keeps rows the same height whatever aspect ratio the upload has.
          */}
          <Image
            src={thumbnailUrl(entry.videoId)}
            alt=""
            w="120px"
            h="68px"
            objectFit="cover"
            flexShrink={0}
            bg="var(--tt-border)"
          />

          <Box py={2} minW={0} flex="1">
            <Text fontWeight="semibold" truncate>
              {entry.title}
            </Text>
            <Text fontSize="sm" color="var(--tt-muted)" truncate>
              {entry.artist}
            </Text>
          </Box>

          <Flex align="center" gap={4} pe={4} flexShrink={0}>
            <Box textAlign="right">
              <Text fontSize="sm" fontWeight="semibold">
                ≈{Math.round(entry.requiredWpm)} wpm
              </Text>
              <Text fontSize="xs" color="var(--tt-muted)">
                {formatDuration(entry.durationSec)} · {entry.lineCount} lines
              </Text>
            </Box>
            {busy && <Spinner size="sm" />}
          </Flex>
        </Flex>
      </Box>

      {canCurate && (
        <Flex direction="column" justify="center" gap={1} px={2} borderLeftWidth="1px" borderColor="var(--tt-border)">
          {/*
            The arrows walk the graded ladder only. Freestyle is not a rung — stepping "down" from
            Insane into it would say it is harder still, which is exactly the wrong idea — so
            moving on and off it is a separate, named action.
          */}
          {inFreestyle ? (
            <Button
              size="2xs"
              variant="ghost"
              disabled={working}
              onClick={() => void move('medium')}
              title="Put this song on the graded ladder"
            >
              Grade
            </Button>
          ) : (
            <>
              <Flex gap={1}>
                <Button
                  size="2xs"
                  variant="ghost"
                  disabled={working || rung <= 0}
                  onClick={() => void move(LADDER[rung - 1]!.tier)}
                  title="Move to an easier tier"
                >
                  ↑
                </Button>
                <Button
                  size="2xs"
                  variant="ghost"
                  disabled={working || rung >= LADDER.length - 1}
                  onClick={() => void move(LADDER[rung + 1]!.tier)}
                  title="Move to a harder tier"
                >
                  ↓
                </Button>
              </Flex>
              <Button
                size="2xs"
                variant="ghost"
                disabled={working}
                onClick={() => void move('freestyle')}
                title="Take this song off the graded ladder"
              >
                Freestyle
              </Button>
            </>
          )}
          <Button size="2xs" variant="ghost" colorPalette="red" disabled={working} onClick={() => void remove()}>
            Remove
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
