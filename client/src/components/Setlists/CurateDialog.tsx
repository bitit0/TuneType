import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Flex, Heading, Image, Input, Spinner, Stack, Text } from '@chakra-ui/react';
import type { PlayableTrack, SetlistTier } from '@shared/types';
import { addToSetlist, thumbnailUrl, toSetlistSubmission } from '@/lib/api/setlists';
import { searchPlayableTracks, LrclibError } from '@/lib/lrclib/client';
import { analyzeDifficulty } from '@/lib/scoring/difficulty';
import { parseVideoId } from '@/lib/youtube/parseVideoId';
import { BAND_PALETTE } from '@/components/Difficulty/PaceBadge';

/**
 * Adding a song to a setlist.
 *
 * Two things have to be pinned down and neither can be skipped: which LRCLIB entry supplies the
 * lyrics, and which video they were verified against. A YouTube link alone is not enough — the
 * words come from a different service, matched by artist and title, and picking the wrong entry
 * yields a song whose lyrics are subtly not the ones being sung. So the track is chosen from a
 * search and the video is pasted, which is the same pair of decisions a player makes, made once by
 * a curator so nobody else has to.
 *
 * The tier defaults to whatever the pace estimate suggests and is then the curator's to override.
 * That is the intended relationship between the two: the estimate reads timings, the curator has
 * heard the song.
 */

const TIER_OPTIONS: ReadonlyArray<{ tier: SetlistTier; label: string }> = [
  { tier: 'easy', label: 'Easy' },
  { tier: 'medium', label: 'Medium' },
  { tier: 'hard', label: 'Hard' },
  { tier: 'insane', label: 'Insane' },
  { tier: 'freestyle', label: 'Freestyle' },
];

export function CurateDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" colorPalette="blue" onClick={() => setOpen(true)}>
        Add a song
      </Button>
      {open && <Dialog onClose={() => setOpen(false)} onAdded={onAdded} />}
    </>
  );
}

function Dialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlayableTrack[]>([]);
  const [searched, setSearched] = useState(false);

  const [track, setTrack] = useState<PlayableTrack | null>(null);
  const [link, setLink] = useState('');
  const [tier, setTier] = useState<SetlistTier>('medium');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
    };
  }, [onClose]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setError(null);

    try {
      setResults(await searchPlayableTracks(query, controller.signal));
      setSearched(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof LrclibError ? err.message : 'Could not search LRCLIB.');
    } finally {
      setSearching(false);
    }
  }

  function choose(chosen: PlayableTrack) {
    setTrack(chosen);
    // Start from what the timings say, then let the curator disagree with it.
    setTier(analyzeDifficulty(chosen.lines).band);
  }

  async function save() {
    if (!track) return;

    const videoId = parseVideoId(link);
    if (!videoId) {
      setError('That does not look like a YouTube link or video ID.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await addToSetlist(toSetlistSubmission(track, videoId, tier));
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that song.');
      setSaving(false);
    }
  }

  const difficulty = track ? analyzeDifficulty(track.lines) : null;
  const previewId = parseVideoId(link);

  return (
    <Flex
      position="fixed"
      inset={0}
      bg="rgba(0,0,0,0.6)"
      align="center"
      justify="center"
      zIndex={1000}
      p={4}
      onClick={onClose}
    >
      <Box
        bg="var(--tt-surface)"
        borderWidth="1px"
        borderColor="var(--tt-border)"
        borderRadius="lg"
        p={6}
        w="100%"
        maxW="2xl"
        maxH="90vh"
        overflowY="auto"
        onClick={(event) => event.stopPropagation()}
      >
        <Heading size="md" mb={1}>
          Add a song
        </Heading>
        <Text fontSize="sm" color="var(--tt-muted)" mb={5}>
          Find the lyrics on LRCLIB, then paste the video you have checked them against.
        </Text>

        <Stack gap={5}>
          <Box>
            <Text fontSize="xs" color="var(--tt-muted)" mb={2}>
              1 · THE TRACK
            </Text>

            {track ? (
              <Flex
                align="center"
                justify="space-between"
                gap={3}
                borderWidth="1px"
                borderColor="var(--tt-accent)"
                borderRadius="md"
                p={3}
              >
                <Box minW={0}>
                  <Text fontWeight="semibold" truncate>
                    {track.title}
                  </Text>
                  <Text fontSize="sm" color="var(--tt-muted)" truncate>
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''} · {track.lines.length} lines
                  </Text>
                </Box>
                <Button size="xs" variant="outline" onClick={() => setTrack(null)}>
                  Change
                </Button>
              </Flex>
            ) : (
              <Stack gap={3}>
                <form onSubmit={search}>
                  <Flex gap={2}>
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Song title, or title and artist"
                      bg="var(--tt-bg)"
                      borderColor="var(--tt-border)"
                      autoFocus
                    />
                    <Button type="submit" disabled={searching}>
                      Search
                    </Button>
                  </Flex>
                </form>

                {searching && (
                  <Flex align="center" gap={2} color="var(--tt-muted)" fontSize="sm">
                    <Spinner size="xs" /> <Text>Searching LRCLIB…</Text>
                  </Flex>
                )}

                {searched && !searching && results.length === 0 && (
                  <Text fontSize="sm" color="var(--tt-muted)">
                    No synced lyrics for that search. Only line-synced entries can be curated, since
                    nothing else is playable.
                  </Text>
                )}

                {results.length > 0 && (
                  <Stack gap={1} maxH="240px" overflowY="auto">
                    {results.map((result) => (
                      <Flex
                        key={result.lrclibId}
                        as="button"
                        onClick={() => choose(result)}
                        align="center"
                        justify="space-between"
                        gap={3}
                        textAlign="left"
                        p={2}
                        borderWidth="1px"
                        borderColor="var(--tt-border)"
                        borderRadius="md"
                        _hover={{ borderColor: 'var(--tt-accent)' }}
                      >
                        <Box minW={0}>
                          <Text fontSize="sm" fontWeight="medium" truncate>
                            {result.title}
                          </Text>
                          <Text fontSize="xs" color="var(--tt-muted)" truncate>
                            {result.artist}
                          </Text>
                        </Box>
                        <Badge
                          colorPalette={BAND_PALETTE[analyzeDifficulty(result.lines).band]}
                          variant="subtle"
                          flexShrink={0}
                        >
                          ≈{Math.round(analyzeDifficulty(result.lines).requiredWpm)}
                        </Badge>
                      </Flex>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Box>

          <Box>
            <Text fontSize="xs" color="var(--tt-muted)" mb={2}>
              2 · THE VIDEO
            </Text>
            <Flex gap={3} align="flex-start">
              <Input
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setError(null);
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                bg="var(--tt-bg)"
                borderColor="var(--tt-border)"
              />
              {/* Immediate proof the link resolved to the video they meant, before it is saved. */}
              {previewId && (
                <Image
                  src={thumbnailUrl(previewId)}
                  alt=""
                  w="107px"
                  h="60px"
                  objectFit="cover"
                  borderRadius="md"
                  flexShrink={0}
                  bg="var(--tt-border)"
                />
              )}
            </Flex>
          </Box>

          <Box>
            <Text fontSize="xs" color="var(--tt-muted)" mb={2}>
              3 · TIER
            </Text>
            <Flex gap={2} wrap="wrap">
              {TIER_OPTIONS.map((option) => (
                <Button
                  key={option.tier}
                  size="xs"
                  variant={tier === option.tier ? 'solid' : 'outline'}
                  colorPalette={tier === option.tier ? BAND_PALETTE[option.tier] : undefined}
                  onClick={() => setTier(option.tier)}
                >
                  {option.label}
                </Button>
              ))}
            </Flex>
            {difficulty && (
              <Text fontSize="xs" color="var(--tt-muted)" mt={2}>
                Needs about {Math.round(difficulty.requiredWpm)} wpm, up to{' '}
                {Math.round(difficulty.peakWpm)} on its hardest stretch — the estimate suggests{' '}
                <strong>{difficulty.band}</strong>. It only measures how fast the words arrive, so
                overrule it if the song is harder than that makes it sound. Freestyle is never
                suggested: it is the shelf for songs you want to keep without grading them.
              </Text>
            )}
          </Box>

          {error && (
            <Text fontSize="sm" color="var(--tt-wrong)">
              {error}
            </Text>
          )}

          <Flex gap={3} justify="flex-end">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!track || !previewId || saving}
              onClick={() => void save()}
            >
              {saving ? 'Adding…' : 'Add to setlist'}
            </Button>
          </Flex>
        </Stack>
      </Box>
    </Flex>
  );
}
