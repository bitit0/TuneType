import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { SetlistEntry } from '@shared/types';
import { fetchSetlists } from '@/lib/api/setlists';
import { fetchTrackById, LrclibError } from '@/lib/lrclib/client';
import { BAND_PALETTE } from '@/components/Difficulty/PaceBadge';
import { CurateDialog } from '@/components/Setlists/CurateDialog';
import { EntryCard } from '@/components/Setlists/EntryCard';
import { TIERS } from '@/components/Setlists/tiers';
import { useSessionStore } from '@/store/sessionStore';
import { useAccountStore } from '@/store/accountStore';
import { useAuthStore } from '@/store/authStore';
import { keyWeights, practiceFit } from '@/lib/scoring/practice';

/**
 * The curated setlists — the game's front door for anyone who does not already have a song in mind.
 *
 * Everything else here finds songs by search, which means taking whatever LRCLIB has and hoping
 * the video syncs. These are the ones somebody has already played and vouched for, sorted into
 * tiers so there is a place to start and a place to work towards.
 */


/** One ranked recommendation. Held in memory for the length of the visit and never stored. */
interface PracticePick {
  entry: SetlistEntry;
  load: number;
  culprits: string[];
}

/** LRCLIB requests in flight at once while ranking. Polite to a free service. */
const PICK_BATCH = 5;

/** How many songs to recommend. A short list is a decision; a long one is another search. */
const PICK_COUNT = 3;

/**
 * How many songs each tier shows here.
 *
 * The index is a way in, not a catalogue: three per tier fits five tiers on a screen and says what
 * each one feels like. The rest are one click away on the tier's own page.
 */
const PREVIEW_COUNT = 3;

export function SetlistsPage() {
  const navigate = useNavigate();
  const beginRun = useSessionStore((s) => s.beginRun);

  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [canCurate, setCanCurate] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Lifetime key counts, the input to the practice picks below. Null when signed out. */
  const keyTally = useAccountStore((s) => s.overview?.stats.keyTally ?? null);

  /*
   * Reading setlists works signed out, but the same response carries `canCurate` — and that is only
   * true if a token went with the request. Firebase restores the session asynchronously, so on a
   * cold load `currentUser` is still null when this page mounts and the request goes out as a
   * guest. The curator then sees no editing controls on their own setlists until they navigate
   * again.
   *
   * Waiting on `initializing` closes that window, and keying the effect on the uid reloads when the
   * session actually resolves — or when someone signs in or out without leaving the page.
   */
  const authInitializing = useAuthStore((s) => s.initializing);
  const uid = useAuthStore((s) => s.user?.uid ?? null);

  const [picks, setPicks] = useState<PracticePick[] | null>(null);
  const [picking, setPicking] = useState(false);

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
    if (authInitializing) return;
    void load();
    return () => abortRef.current?.abort();
  }, [load, authInitializing, uid]);

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

      // The entry id travels with the run, so the results screen knows it can be scored server-side.
      beginRun(track, entry.videoId, entry.id);
      navigate('/play');
    } catch (err) {
      setError(err instanceof LrclibError ? err.message : 'Could not load that song.');
    } finally {
      setLoadingId(null);
    }
  }

  /**
   * Ranks the curated songs by how heavily they lean on the keys this player misses.
   *
   * Runs on demand rather than on load, because it costs one LRCLIB request per entry. Those
   * requests are the point: the letter distribution a ranking needs is exactly the thing that may
   * not be stored against a track, so the measurement happens here, in the browser, and the lyrics
   * are dropped the moment a number falls out of them.
   */
  async function rankForWeakKeys() {
    if (!keyTally) return;

    setPicking(true);
    setError(null);

    try {
      const weights = keyWeights(keyTally);
      const scored: PracticePick[] = [];

      // In small batches. A curated list is short by design, but firing every request at a free
      // public service at once is rude whatever its length.
      for (let i = 0; i < entries.length; i += PICK_BATCH) {
        const batch = entries.slice(i, i + PICK_BATCH);
        const tracks = await Promise.all(
          batch.map((entry) => fetchTrackById(entry.lrclibId).catch(() => null)),
        );

        batch.forEach((entry, j) => {
          const track = tracks[j];
          if (!track) return;
          scored.push({ entry, ...practiceFit(track.lines, weights) });
        });
      }

      scored.sort((a, b) => b.load - a.load);
      setPicks(scored.slice(0, PICK_COUNT));
    } catch (err) {
      setError(err instanceof LrclibError ? err.message : 'Could not read the songs to rank them.');
    } finally {
      setPicking(false);
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

      {/*
        Practice picks. Offered only to someone signed in with a history, since there is nothing to
        rank against otherwise.
      */}
      {keyTally && entries.length > 0 && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg" p={5}>
          <Flex justify="space-between" align="flex-start" gap={4} wrap="wrap" mb={picks ? 4 : 0}>
            <Box>
              <Heading size="sm" mb={1}>
                Practise your weak keys
              </Heading>
              <Text fontSize="sm" color="var(--tt-muted)" maxW="2xl">
                Ranks these songs by how often they ask for the keys you actually miss. Reads the
                lyrics in your browser to do it and keeps none of them.
              </Text>
            </Box>
            <Button size="sm" onClick={() => void rankForWeakKeys()} disabled={picking}>
              {picking ? 'Reading…' : picks ? 'Rank again' : 'Rank for me'}
            </Button>
          </Flex>

          {picks && picks.length === 0 && (
            <Text fontSize="sm" color="var(--tt-muted)">
              None of these songs could be read from LRCLIB just now.
            </Text>
          )}

          {picks && picks.length > 0 && (
            <Stack gap={2}>
              {picks.map(({ entry, load, culprits }) => (
                <Flex
                  key={entry.id}
                  as="button"
                  onClick={() => void play(entry)}
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
                  <Box minW={0} flex="1">
                    <Text fontWeight="semibold" truncate>
                      {entry.title}
                    </Text>
                    <Text fontSize="sm" color="var(--tt-muted)" truncate>
                      {entry.artist}
                    </Text>
                  </Box>
                  <Flex gap={1} flexShrink={0}>
                    {culprits.map((key) => (
                      <Box
                        key={key}
                        px={2}
                        py={1}
                        borderWidth="1px"
                        borderColor="var(--tt-border)"
                        borderRadius="sm"
                        fontSize="sm"
                        fontWeight="bold"
                      >
                        {key}
                      </Box>
                    ))}
                  </Flex>
                  <Text
                    minW="64px"
                    textAlign="right"
                    fontSize="sm"
                    color="var(--tt-wrong)"
                    flexShrink={0}
                  >
                    {(load * 100).toFixed(1)}%
                  </Text>
                </Flex>
              ))}
              <Text fontSize="xs" color="var(--tt-muted)">
                The percentage is how often you would be expected to mistype a character in that
                song, given your history. The keys beside it are the ones driving it.
              </Text>
            </Stack>
          )}
        </Box>
      )}

      {/*
        Tiers side by side rather than stacked. Three across is the point — the graded ladder reads
        as a progression when Easy, Medium and Hard are in one line, and as a very long page when
        they are not. Insane and Freestyle wrap to the second row.
      */}
      <Grid
        // minmax(0, …) rather than 1fr: a plain 1fr keeps an implicit min-width of auto, so a long
        // title widens its own column and the tiers stop lining up.
        templateColumns={{
          base: 'minmax(0, 1fr)',
          md: 'repeat(2, minmax(0, 1fr))',
          xl: 'repeat(3, minmax(0, 1fr))',
        }}
        gap={6}
        alignItems="start"
      >
        {TIERS.map(({ tier, label, blurb }) => {
          const songs = entries.filter((entry) => entry.tier === tier);

          const shown = songs.slice(0, PREVIEW_COUNT);

          return (
            <Box key={tier}>
              <Flex align="baseline" gap={3} mb={1}>
                <RouterLink to={`/setlists/${tier}`}>
                  <Heading size="md" _hover={{ color: 'var(--tt-accent)' }}>
                    {label}
                  </Heading>
                </RouterLink>
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
                    {shown.map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        canCurate={canCurate}
                        busy={loadingId === entry.id}
                        onPlay={() => void play(entry)}
                        onChanged={load}
                      />
                    ))}

                    {songs.length > shown.length && (
                      <RouterLink to={`/setlists/${tier}`}>
                        <Text fontSize="sm" color="var(--tt-accent)" pt={1}>
                          All {songs.length} {label.toLowerCase()} songs →
                        </Text>
                      </RouterLink>
                    )}
                </Stack>
              )}
            </Box>
          );
        })}
      </Grid>
    </Stack>
  );
}
