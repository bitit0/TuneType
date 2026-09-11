import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Flex, Grid, Heading, Link as ChakraLink, Spinner, Stack, Text } from '@chakra-ui/react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { LineResult } from '@shared/types';
import { useSessionStore } from '@/store/sessionStore';
import { useAccountStore } from '@/store/accountStore';
import { useAuthStore } from '@/store/authStore';
import { isAuthConfigured } from '@/lib/firebase';
import { analyzeDifficulty } from '@/lib/scoring/difficulty';
import { keyErrorRates } from '@/lib/scoring/keys';
import { postVerifiedRun, toVerifiedRunSubmission, type VerifiedRunResult } from '@/lib/api/setlists';
import { Avatar } from '@/components/Auth/Avatar';
import { POINTS_PER_CORRECT_CHAR } from '@/lib/scoring/constants';

/**
 * The share of what a line was worth that the player earned, 0-1.
 *
 * Accuracy and timing fold into one number here because either alone ranks lines misleadingly — a
 * line typed perfectly but seconds late and one typed badly on time are both bad, and the score
 * already knows how to weigh them against each other.
 */
function lineShare(line: LineResult): number {
  const maximum = line.targetLength * POINTS_PER_CORRECT_CHAR;
  return maximum === 0 ? 1 : line.score / maximum;
}

/** Keys with no glyph of their own, so a row does not render as blank. */
const KEY_LABEL: Record<string, string> = { ' ': 'space' };

/**
 * The per-line table's columns, shared by its header and its rows.
 *
 * One template rather than matching widths on each cell, so the two cannot drift apart. The lyric
 * column takes what is left; everything else is fixed, because numbers in a ragged column are
 * harder to compare than the comparison is worth.
 */
const LINE_COLUMNS = '44px minmax(0, 1fr) 56px 48px 60px 60px';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
      <Text fontSize="xs" color="var(--tt-muted)" letterSpacing="wide">
        {label.toUpperCase()}
      </Text>
      <Text fontSize="3xl" fontWeight="bold" lineHeight="1.2">
        {value}
      </Text>
      {hint && (
        <Text fontSize="xs" color="var(--tt-muted)">
          {hint}
        </Text>
      )}
    </Box>
  );
}

/** The one line of text about whether this run made it into the account. */
function SaveStatus() {
  const user = useAuthStore((s) => s.user);
  const saveState = useAccountStore((s) => s.saveState);
  const saveError = useAccountStore((s) => s.saveError);

  if (!isAuthConfigured()) return null;

  if (!user) {
    return (
      <Text fontSize="sm" color="var(--tt-muted)">
        Signed out, so this run wasn't saved. Sign in to keep a history and track personal bests.
      </Text>
    );
  }

  switch (saveState) {
    case 'saving':
      return (
        <Flex align="center" gap={2} color="var(--tt-muted)" fontSize="sm">
          <Spinner size="xs" /> <Text>Saving…</Text>
        </Flex>
      );
    case 'saved':
      return (
        <Text fontSize="sm" color="var(--tt-muted)">
          Saved to your account —{' '}
          <ChakraLink asChild color="var(--tt-accent)">
            <Link to="/profile">see your history</Link>
          </ChakraLink>
          .
        </Text>
      );
    case 'unavailable':
      return (
        <Text fontSize="sm" color="var(--tt-muted)">
          This server has no account storage configured, so the run wasn't saved.
        </Text>
      );
    case 'error':
      return (
        <Text fontSize="sm" color="var(--tt-wrong)">
          {saveError ?? "Couldn't save this run."} Your score above is unaffected.
        </Text>
      );
    default:
      return null;
  }
}

export function ResultsPage() {
  const navigate = useNavigate();
  const track = useSessionStore((s) => s.track);
  const videoId = useSessionStore((s) => s.videoId);
  const offsetMs = useSessionStore((s) => s.offsetMs);
  const summarize = useSessionStore((s) => s.summarize);
  const beginRun = useSessionStore((s) => s.beginRun);
  const setlistEntryId = useSessionStore((s) => s.setlistEntryId);

  const user = useAuthStore((s) => s.user);
  const saveRun = useAccountStore((s) => s.saveRun);
  const resetSaveState = useAccountStore((s) => s.resetSaveState);

  const keystrokes = useSessionStore((s) => s.keystrokes);

  const summary = useMemo(() => summarize(), [summarize]);
  const difficulty = useMemo(() => analyzeDifficulty(track?.lines ?? []), [track]);
  const keyErrors = useMemo(() => keyErrorRates(keystrokes), [keystrokes]);

  const [worstFirst, setWorstFirst] = useState(false);

  /** The server's verdict on this run, when it was played from a setlist. */
  const [verified, setVerified] = useState<VerifiedRunResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Saving is a side effect of arriving here, and must happen exactly once. StrictMode mounts
  // effects twice in development, and "Play again" returns to this screen with a fresh run, so the
  // guard is keyed on identity rather than being a bare boolean.
  const savedKey = useRef<string | null>(null);

  useEffect(() => {
    // A run with no video is one that was never played — reachable only by navigating straight to
    // this route — and a saved run is keyed to the video it was timed against.
    if (!user || !track || !videoId) return;

    const key = `${track.lrclibId}:${videoId}:${summary.totalScore}:${summary.typingMs}`;
    if (savedKey.current === key) return;
    savedKey.current = key;

    resetSaveState();
    void saveRun(track, videoId, offsetMs, summary, keystrokes);
  }, [user, track, videoId, offsetMs, summary, keystrokes, saveRun, resetSaveState]);

  /*
   * A curated run also goes to the leaderboard, which is a separate trip on purpose.
   *
   * The account save records what you did; this one asks the server what it was worth. They can
   * fail independently, and a leaderboard that is down should not cost anyone their history.
   */
  const rankedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !setlistEntryId || summary.lines.length === 0) return;

    const key = `${setlistEntryId}:${summary.totalScore}:${summary.typingMs}`;
    if (rankedKey.current === key) return;
    rankedKey.current = key;

    setVerifyError(null);
    postVerifiedRun(toVerifiedRunSubmission(setlistEntryId, offsetMs, summary))
      .then(setVerified)
      .catch((error: unknown) => {
        setVerifyError(
          error instanceof Error ? error.message : 'Could not post this run to the leaderboard.',
        );
      });
  }, [user, setlistEntryId, offsetMs, summary]);

  if (!track) return <Navigate to="/" replace />;

  const completion =
    summary.linesAttempted === 0
      ? 0
      : Math.round((summary.linesCompleted / summary.linesAttempted) * 100);

  return (
    <Stack gap={6} maxW="4xl">
      <Box>
        <Heading size="lg">Run complete</Heading>
        <Text color="var(--tt-muted)">
          {track.artist} — {track.title}
        </Text>
      </Box>

      <Grid templateColumns={{ base: '1fr 1fr', md: 'repeat(5, 1fr)' }} gap={4}>
        <Stat label="Score" value={summary.totalScore.toLocaleString()} />
        <Stat
          label="WPM"
          value={summary.wpm.toFixed(1)}
          hint={`correct chars over ${(summary.typingMs / 1000).toFixed(1)}s typing`}
        />
        {/*
          The number that gives the one to its left a meaning. 70 WPM is fast on a song that needed
          50 and behind on a song that needed 90, and without this the results screen could not
          tell those apart.
        */}
        <Stat
          label="Needed"
          value={`${Math.round(difficulty.requiredWpm)}`}
          hint={
            difficulty.requiredWpm > 0
              ? `${Math.round((summary.wpm / difficulty.requiredWpm) * 100)}% of the song's pace`
              : undefined
          }
        />
        <Stat label="Accuracy" value={`${Math.round(summary.accuracy * 100)}%`} />
        <Stat
          label="Lines"
          value={`${summary.linesCompleted}/${summary.linesAttempted}`}
          hint={`${completion}% finished in time`}
        />
      </Grid>

      <SaveStatus />

      {/*
        The server's own score, shown next to the browser's rather than instead of it. They should
        agree — a cross-check test holds the two implementations to the same numbers — and if they
        ever do not, seeing both is what makes that visible instead of silent.
      */}
      {setlistEntryId && (verified || verifyError) && (
        <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
          {verifyError ? (
            <Text fontSize="sm" color="var(--tt-muted)">
              {verifyError} Your score above still stands — it just is not on the board.
            </Text>
          ) : (
            verified && (
              <Stack gap={3}>
                <Flex justify="space-between" align="baseline" gap={3} wrap="wrap">
                  <Heading size="sm">Leaderboard</Heading>
                  <Text fontSize="sm" color="var(--tt-muted)">
                    {verified.improved
                      ? `New personal best on this song — ${verified.score.totalScore.toLocaleString()} scored by the server.`
                      : `Server scored ${verified.score.totalScore.toLocaleString()}. Your best here still stands.`}
                  </Text>
                </Flex>

                <Stack gap={1}>
                  {verified.rows.slice(0, 10).map((row, i) => (
                    <Flex
                      key={row.uid}
                      align="center"
                      gap={3}
                      fontSize="sm"
                      px={3}
                      py={2}
                      borderWidth="1px"
                      borderColor={row.uid === user?.uid ? 'var(--tt-accent)' : 'var(--tt-border)'}
                      borderRadius="sm"
                    >
                      <Text color="var(--tt-muted)" minW="24px">
                        {i + 1}
                      </Text>
                      <Avatar name={row.displayName} color={row.avatarColor} src={row.photo} size={24} />
                      <Text flex="1" minW={0} truncate>
                        {row.displayName}
                      </Text>
                      <Text minW="56px" textAlign="right" color="var(--tt-muted)">
                        {Math.round(row.accuracy * 100)}%
                      </Text>
                      <Text minW="56px" textAlign="right" color="var(--tt-muted)">
                        {row.wpm.toFixed(0)} wpm
                      </Text>
                      <Text minW="72px" textAlign="right" fontWeight="semibold">
                        {row.score.toLocaleString()}
                      </Text>
                    </Flex>
                  ))}
                </Stack>
              </Stack>
            )
          )}
        </Box>
      )}

      <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
        <Text fontSize="sm" color="var(--tt-muted)">
          WPM is measured over the {(summary.typingMs / 1000).toFixed(1)}s actually spent typing
          lines, not the {(summary.elapsedMs / 1000).toFixed(1)}s the run took — a clock that kept
          running through instrumental breaks would be scoring the song, not you. The tolerances
          behind the rest (how much slack a late line gets, where the multiplier floors out) live in{' '}
          <Box as="code" fontSize="xs">
            lib/scoring/constants.ts
          </Box>{' '}
          and are first guesses. If a line felt unfairly scored, that file is the place to argue
          with it.
        </Text>
      </Box>

      {summary.lines.length > 0 && (
        <Box>
          <Flex justify="space-between" align="baseline" mb={1} gap={3}>
            <Heading size="sm">Per line</Heading>
            <Button size="xs" variant="ghost" onClick={() => setWorstFirst((v) => !v)}>
              {worstFirst ? 'In order' : 'Worst first'}
            </Button>
          </Flex>
          <Stack gap={1} maxH="320px" overflowY="auto">
            {/*
              Sticky, and inside the scroll container rather than above it. A header outside would
              sit beside the scrollbar instead of over it, and every column would be off by its
              width the moment the list overflowed.
            */}
            <Grid
              templateColumns={LINE_COLUMNS}
              gap={3}
              position="sticky"
              top={0}
              zIndex={1}
              bg="var(--tt-bg)"
              alignItems="center"
              fontSize="xs"
              color="var(--tt-muted)"
              letterSpacing="wide"
              px={3}
              py={1}
              borderWidth="1px"
              borderColor="transparent"
            >
              <Box>#</Box>
              <Box />
              <Box textAlign="right">TYPING</Box>
              <Box textAlign="right">ACC</Box>
              <Box textAlign="right">TIMING</Box>
              <Box textAlign="right">SCORE</Box>
            </Grid>

            {(worstFirst
              ? [...summary.lines].sort((a, b) => lineShare(a) - lineShare(b))
              : summary.lines
            ).map((line) => {
              const accuracy =
                line.typedChars === 0 ? 0 : Math.round((line.correctChars / line.typedChars) * 100);
              return (
                <Grid
                  key={line.lineIndex}
                  templateColumns={LINE_COLUMNS}
                  gap={3}
                  alignItems="center"
                  fontSize="sm"
                  px={3}
                  py={2}
                  borderWidth="1px"
                  borderColor="var(--tt-border)"
                  borderRadius="sm"
                >
                  <Text color="var(--tt-muted)">#{line.lineIndex + 1}</Text>
                  {/*
                    The words themselves, so a bad row says which line it was. They are already in
                    memory for the run and go no further — the same rule the saved run follows.
                  */}
                  <Text truncate>{track.lines[line.lineIndex]?.text ?? ''}</Text>
                  <Text textAlign="right" color="var(--tt-muted)">
                    {(line.typingMs / 1000).toFixed(1)}s
                  </Text>
                  <Text textAlign="right">{accuracy}%</Text>
                  <Text
                    textAlign="right"
                    color={line.timingMultiplier === 1 ? 'var(--tt-correct)' : 'var(--tt-muted)'}
                  >
                    ×{line.timingMultiplier.toFixed(2)}
                  </Text>
                  <Text textAlign="right" fontWeight="semibold">
                    {line.score}
                  </Text>
                </Grid>
              );
            })}
          </Stack>
        </Box>
      )}

      {/*
        Which keys to practise, counted over the whole run rather than per line. Ranked by how many
        times each was missed, so a key fluffed once on its only appearance does not lead the list.
      */}
      {keyErrors.length > 0 && (
        <Box>
          <Heading size="sm" mb={1}>
            Keys you missed
          </Heading>
          <Text fontSize="xs" color="var(--tt-muted)" mb={3}>
            Misses out of times the key came up
          </Text>
          <Flex gap={2} wrap="wrap">
            {keyErrors.slice(0, 10).map((key) => (
              <Flex
                key={key.key}
                direction="column"
                align="center"
                minW="64px"
                px={3}
                py={2}
                borderWidth="1px"
                borderColor="var(--tt-border)"
                borderRadius="md"
                bg="var(--tt-surface)"
              >
                <Text fontSize="xl" fontWeight="bold" lineHeight="1.2">
                  {KEY_LABEL[key.key] ?? key.key}
                </Text>
                <Text fontSize="xs" color="var(--tt-muted)">
                  {key.misses}/{key.attempts}
                </Text>
                <Text fontSize="xs" color="var(--tt-wrong)">
                  {Math.round(key.rate * 100)}%
                </Text>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}

      <Flex gap={3}>
        <Button
          colorPalette="blue"
          onClick={() => {
            if (videoId) beginRun(track, videoId);
            navigate('/play');
          }}
        >
          Play again
        </Button>
        <Button variant="outline" onClick={() => navigate('/')}>
          Another song
        </Button>
      </Flex>
    </Stack>
  );
}
