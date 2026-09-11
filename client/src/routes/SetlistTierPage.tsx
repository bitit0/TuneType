import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Flex, Grid, Heading, Spinner, Stack, Text } from '@chakra-ui/react';
import { Link as RouterLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { SetlistEntry } from '@shared/types';
import { fetchSetlists } from '@/lib/api/setlists';
import { fetchTrackById, LrclibError } from '@/lib/lrclib/client';
import { BAND_PALETTE } from '@/components/Difficulty/PaceBadge';
import { EntryCard } from '@/components/Setlists/EntryCard';
import { TIERS } from '@/components/Setlists/tiers';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';

/**
 * Every curated song in one tier.
 *
 * The index shows three per tier because five tiers have to fit on a screen together; this is
 * where the rest live. Same cards, same order — ascending required WPM, so the page reads as a
 * progression from the gentlest song in the tier to the most demanding.
 *
 * Reads the whole board and filters here rather than asking the server for one tier. A curated list
 * is small by design, the index has usually already fetched it, and a per-tier endpoint would be a
 * second thing to keep in step with the first for no saved bytes.
 */
export function SetlistTierPage() {
  const { tier: tierParam } = useParams();
  const navigate = useNavigate();
  const beginRun = useSessionStore((s) => s.beginRun);

  const meta = TIERS.find((entry) => entry.tier === tierParam);

  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [canCurate, setCanCurate] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Same reason as the index: a request sent before Firebase restores the session arrives as a
  // guest, and the curator loses their editing controls until they navigate again.
  const authInitializing = useAuthStore((s) => s.initializing);
  const uid = useAuthStore((s) => s.user?.uid ?? null);

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
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    if (authInitializing) return;
    void load();
    return () => abortRef.current?.abort();
  }, [load, authInitializing, uid]);

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

      beginRun(track, entry.videoId, entry.id);
      navigate('/play');
    } catch (err) {
      setError(err instanceof LrclibError ? err.message : 'Could not load that song.');
    } finally {
      setLoadingId(null);
    }
  }

  // An unknown tier in the URL is a typo or a stale link, not an error worth a screen of its own.
  if (!meta) return <Navigate to="/setlists" replace />;

  if (status === 'loading') {
    return (
      <Flex align="center" gap={3} color="var(--tt-muted)">
        <Spinner size="sm" /> <Text>Loading {meta.label.toLowerCase()} songs…</Text>
      </Flex>
    );
  }

  if (status === 'unavailable') {
    return (
      <Stack gap={4} maxW="xl">
        <Heading size="lg">Setlists are not set up here</Heading>
        <Text color="var(--tt-muted)">
          This server has no database configured, so there are no curated songs to show. Searching
          for a song works exactly as it always does.
        </Text>
        <Button alignSelf="flex-start" onClick={() => navigate('/')} colorPalette="blue">
          Find a song
        </Button>
      </Stack>
    );
  }

  const songs = entries.filter((entry) => entry.tier === meta.tier);

  return (
    <Stack gap={6}>
      <Box>
        <RouterLink to="/setlists">
          <Text fontSize="sm" color="var(--tt-muted)" _hover={{ color: 'var(--tt-accent)' }} mb={2}>
            ← All setlists
          </Text>
        </RouterLink>

        <Flex align="baseline" gap={3} mb={1}>
          <Heading size="lg">{meta.label}</Heading>
          <Badge colorPalette={BAND_PALETTE[meta.tier]} variant="subtle">
            {songs.length}
          </Badge>
        </Flex>
        <Text color="var(--tt-muted)" maxW="2xl">
          {meta.blurb}
        </Text>
      </Box>

      {error && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" p={4}>
          <Text color="var(--tt-wrong)">{error}</Text>
        </Box>
      )}

      {songs.length === 0 ? (
        <Box borderWidth="1px" borderStyle="dashed" borderColor="var(--tt-border)" p={6}>
          <Text color="var(--tt-muted)">Nothing curated in this tier yet.</Text>
        </Box>
      ) : (
        <>
          {/*
            Two columns rather than the index's three. The cards are the same width they always
            were; a tier on its own has no siblings to line up with, and a single column across a
            wide container leaves a lot of nothing beside every row.
          */}
          <Grid
            templateColumns={{ base: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }}
            gap={3}
            alignItems="start"
          >
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
          </Grid>

          <Text fontSize="sm" color="var(--tt-muted)">
            Ordered by the pace each song demands, gentlest first — so working down the list is
            working up the tier.
          </Text>
        </>
      )}
    </Stack>
  );
}
