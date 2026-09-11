import { useRef, useState } from 'react';
import { Badge, Box, Button, Flex, Heading, Input, Spinner, Stack, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import type { PlayableTrack } from '@shared/types';
import { searchPlayableTracks, LrclibError } from '@/lib/lrclib/client';
import { PaceBadge } from '@/components/Difficulty/PaceBadge';
import { useSessionStore } from '@/store/sessionStore';

type Status = 'idle' | 'loading' | 'done' | 'error';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SearchPage() {
  const navigate = useNavigate();
  const setTrack = useSessionStore((s) => s.beginRun);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PlayableTrack[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);

    try {
      const tracks = await searchPlayableTracks(query, controller.signal);
      setResults(tracks);
      setStatus('done');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof LrclibError ? err.message : 'Something went wrong searching LRCLIB.');
      setStatus('error');
    }
  }

  function choose(track: PlayableTrack) {
    // The video id is filled in on the next screen; beginRun resets any previous run's state.
    setTrack(track, '');
    navigate('/video');
  }

  return (
    <Stack gap={6}>
      <Box>
        <Heading size="lg" mb={2}>
          Find a song
        </Heading>
        <Text color="var(--tt-muted)">
          Search by title. Adding the artist narrows it down. Results come from LRCLIB and only
          tracks with synced lyrics can be played.
        </Text>
      </Box>

      <form onSubmit={runSearch}>
        <Flex gap={3}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Song title"
            size="lg"
            bg="var(--tt-surface)"
            borderColor="var(--tt-border)"
            autoFocus
          />
          <Button type="submit" size="lg" colorPalette="blue" disabled={status === 'loading'}>
            Search
          </Button>
        </Flex>
      </form>

      {status === 'loading' && (
        <Flex align="center" gap={3} color="var(--tt-muted)">
          <Spinner size="sm" /> <Text>Searching LRCLIB…</Text>
        </Flex>
      )}

      {status === 'error' && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{error}</Text>
        </Box>
      )}

      {/*
        No synced lyrics is a NORMAL outcome, not a failure. LRCLIB's coverage is good but far from
        universal, so this state gets a proper explanation rather than an empty list.
      */}
      {status === 'done' && results.length === 0 && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={6}>
          <Heading size="sm" mb={2}>
            No synced lyrics for that search
          </Heading>
          <Text color="var(--tt-muted)">
            LRCLIB has no line-synced lyrics matching “{query}”. Plain-text-only and instrumental
            entries are filtered out, since neither can be played. Try the exact title, or add the
            artist.
          </Text>
        </Box>
      )}

      {results.length > 0 && (
        <Stack gap={2}>
          {results.map((track) => (
            <Flex
              key={track.lrclibId}
              as="button"
              onClick={() => choose(track)}
              align="center"
              justify="space-between"
              textAlign="left"
              w="100%"
              p={4}
              borderWidth="1px"
              borderColor="var(--tt-border)"
              borderRadius="md"
              bg="var(--tt-surface)"
              _hover={{ borderColor: 'var(--tt-accent)' }}
            >
              <Box>
                <Text fontWeight="semibold">{track.title}</Text>
                <Text fontSize="sm" color="var(--tt-muted)">
                  {track.artist}
                  {track.album ? ` · ${track.album}` : ''}
                </Text>
              </Box>
              <Flex align="center" gap={3}>
                {/* Shown here, before a song is committed to, because it is the one thing that
                    decides whether a track will be fun or hopeless — and it is free to compute. */}
                <PaceBadge lines={track.lines} />
                <Badge variant="subtle">{track.lines.length} lines</Badge>
                <Text fontSize="sm" color="var(--tt-muted)">
                  {formatDuration(track.durationSec)}
                </Text>
              </Flex>
            </Flex>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
