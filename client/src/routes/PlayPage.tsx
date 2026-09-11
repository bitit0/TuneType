import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Grid, Heading, Kbd, Stack, Text } from '@chakra-ui/react';
import { Navigate, useNavigate } from 'react-router-dom';
import { YouTubePlayer } from '@/components/Player/YouTubePlayer';
import { DebugOverlay } from '@/components/Player/DebugOverlay';
import { TimingPanel } from '@/components/Player/TimingPanel';
import { LyricScroller } from '@/components/Lyrics/LyricScroller';
import { VirtualClock, PlayerState } from '@/lib/timing/VirtualClock';
import { useGameLoop } from '@/lib/timing/useGameLoop';
import { useSessionStore } from '@/store/sessionStore';
import { PaceDetail } from '@/components/Difficulty/PaceBadge';
import type { YTPlayer } from '@/lib/youtube/iframeApi';

export function PlayPage() {
  const navigate = useNavigate();

  const track = useSessionStore((s) => s.track);
  const videoId = useSessionStore((s) => s.videoId);
  const activeLineIndex = useSessionStore((s) => s.activeLineIndex);
  const offsetMs = useSessionStore((s) => s.offsetMs);
  const typedByLine = useSessionStore((s) => s.typedByLine);
  const finish = useSessionStore((s) => s.finish);

  const clockRef = useRef<VirtualClock | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const lines = track?.lines ?? [];
  const { countdownMs } = useGameLoop(lines, clockRef);

  const onReady = useCallback((player: YTPlayer) => {
    playerRef.current = player;
    const clock = new VirtualClock(player);
    clockRef.current = clock;
    clock.start();
  }, []);

  const onStateChange = useCallback(
    (state: number) => {
      clockRef.current?.onStateChange(state);
      if (state === PlayerState.ENDED) {
        finish();
        navigate('/results');
      }
    },
    [finish, navigate],
  );

  useEffect(() => () => clockRef.current?.stop(), []);

  if (!track || !videoId) return <Navigate to="/" replace />;

  const typed = typedByLine[activeLineIndex] ?? '';

  function endRun() {
    finish();
    navigate('/results');
  }

  return (
    <Stack gap={5}>
      <Flex justify="space-between" align="baseline" wrap="wrap" gap={2}>
        <Box>
          <Heading size="md">{track.title}</Heading>
          <Text color="var(--tt-muted)" fontSize="sm">
            {track.artist}
          </Text>
          <PaceDetail lines={lines} />
        </Box>
        <Flex gap={2}>
          <Button size="sm" variant="outline" onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? 'Hide' : 'Show'} timing
          </Button>
          <Button size="sm" colorPalette="blue" onClick={endRun}>
            Finish
          </Button>
        </Flex>
      </Flex>

      {playerError && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{playerError}</Text>
        </Box>
      )}

      <Grid templateColumns={{ base: '1fr', lg: '1.4fr 1fr' }} gap={5} alignItems="start">
        <YouTubePlayer
          videoId={videoId}
          onReady={onReady}
          onStateChange={onStateChange}
          onError={setPlayerError}
        />

        <Stack gap={4}>
          {showDebug && <DebugOverlay clockRef={clockRef} offsetMs={offsetMs} />}

          <TimingPanel />
        </Stack>
      </Grid>

      <Box
        borderWidth="1px"
        borderColor="var(--tt-border)"
        borderRadius="md"
        bg="var(--tt-surface)"
        p={6}
      >
        <LyricScroller
          lines={lines}
          activeIndex={activeLineIndex}
          typed={typed}
          countdownMs={countdownMs}
        />
      </Box>

      <Text fontSize="xs" color="var(--tt-muted)">
        Press play on the video, then just type. <Kbd>Backspace</Kbd> corrects the current line.
      </Text>
    </Stack>
  );
}
