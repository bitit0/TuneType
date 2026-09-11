import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Flex, Kbd, Stack, Text } from '@chakra-ui/react';
import type { OffsetConfidence } from '@shared/types';
import { fetchConsensus, submitOffset } from '@/lib/api/offsets';
import { isUnavailable } from '@/lib/api/client';
import { useSessionStore } from '@/store/sessionStore';
import { OFFSET_NUDGE_STEP_MS } from '@/lib/scoring/constants';

/**
 * Timing controls, and the offset store's entire user-facing surface.
 *
 * Three ways to arrive at an offset, in increasing order of effort: inherit what other people
 * measured, tap along with the first line, or nudge until it looks right. The first is what makes
 * the store worth having — once one person has calibrated a video, nobody else has to.
 *
 * Sharing is never automatic. Every submission here is a button someone pressed, because a value
 * captured silently at the end of a run would include every abandoned mid-song experiment, and the
 * consensus is only as good as the intent behind what goes into it.
 */

const CONFIDENCE: Record<OffsetConfidence, { label: string; palette: string; note: string }> = {
  none: {
    label: 'Not calibrated',
    palette: 'gray',
    note: 'Nobody has timed this video against this track yet. If you line it up, everyone after you gets it right first try.',
  },
  provisional: {
    label: 'Provisional',
    palette: 'yellow',
    note: 'Based on one or two measurements. Applied, but worth checking — confirm it and it stops being a guess.',
  },
  confirmed: {
    label: 'Confirmed',
    palette: 'green',
    note: 'Several people agree on this timing. It should be right without you doing anything.',
  },
  contested: {
    label: 'Contested',
    palette: 'red',
    note: 'Measurements for this video disagree by seconds, which usually means it is a different recording — a live take, an edit, or an extended cut. Consider picking another video.',
  },
};

type ShareState = 'idle' | 'sharing' | 'shared' | 'unavailable' | 'error';

export function TimingPanel() {
  const track = useSessionStore((s) => s.track);
  const videoId = useSessionStore((s) => s.videoId);
  const offsetMs = useSessionStore((s) => s.offsetMs);
  const offsetSource = useSessionStore((s) => s.offsetSource);
  const consensus = useSessionStore((s) => s.consensus);
  const calibrating = useSessionStore((s) => s.calibrating);
  const nudgeOffset = useSessionStore((s) => s.nudgeOffset);
  const applyConsensus = useSessionStore((s) => s.applyConsensus);
  const armCalibration = useSessionStore((s) => s.armCalibration);
  const cancelCalibration = useSessionStore((s) => s.cancelCalibration);

  const [shareState, setShareState] = useState<ShareState>('idle');
  const [shareError, setShareError] = useState<string | null>(null);
  const sharedValue = useRef<number | null>(null);

  useEffect(() => {
    if (!track || !videoId) return;

    const controller = new AbortController();

    void fetchConsensus(videoId, track.lrclibId, controller.signal)
      .then(applyConsensus)
      // Silent on purpose. No offset store configured means the game behaves exactly as it did
      // before there was one, and announcing the absence of a feature nobody asked for is noise.
      .catch(() => undefined);

    return () => controller.abort();
  }, [track, videoId, applyConsensus]);

  if (!track || !videoId) return null;

  const status = CONFIDENCE[consensus?.confidence ?? 'none'];

  /*
   * What counts as worth sharing. Playing back a consensus value unchanged is not a measurement —
   * it would just be the existing answer voting for itself, which would inflate the submission
   * count and make a single person's calibration look confirmed.
   */
  const isNewMeasurement = offsetSource === 'tap' || offsetSource === 'nudge';
  const alreadyShared = sharedValue.current === offsetMs;
  const canShare = isNewMeasurement && !alreadyShared && shareState !== 'sharing';

  async function share() {
    if (!track || !videoId) return;

    setShareState('sharing');
    setShareError(null);

    try {
      const updated = await submitOffset({
        videoId,
        lrclibId: track.lrclibId,
        offsetMs,
        source: offsetSource === 'tap' ? 'tap' : 'nudge',
      });

      sharedValue.current = offsetMs;
      // Take the server's recomputed consensus, but do not let it move the player's own offset —
      // they are mid-song and it is lined up the way they want it.
      useSessionStore.setState({ consensus: updated });
      setShareState('shared');
    } catch (error) {
      setShareState(isUnavailable(error) ? 'unavailable' : 'error');
      setShareError(error instanceof Error ? error.message : null);
    }
  }

  return (
    <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={3}>
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontSize="xs" color="var(--tt-muted)">
          LYRIC TIMING
        </Text>
        <Badge colorPalette={status.palette} variant="subtle">
          {status.label}
          {consensus && consensus.submissionCount > 0 && ` · ${consensus.submissionCount}`}
        </Badge>
      </Flex>

      <Flex align="center" gap={2}>
        <Button size="xs" variant="outline" onClick={() => nudgeOffset(-OFFSET_NUDGE_STEP_MS)}>
          −{OFFSET_NUDGE_STEP_MS}ms
        </Button>
        <Text minW="72px" textAlign="center" fontFamily="mono">
          {offsetMs > 0 ? '+' : ''}
          {offsetMs}ms
        </Text>
        <Button size="xs" variant="outline" onClick={() => nudgeOffset(OFFSET_NUDGE_STEP_MS)}>
          +{OFFSET_NUDGE_STEP_MS}ms
        </Button>
      </Flex>

      <Text fontSize="xs" color="var(--tt-muted)" mt={2}>
        <Kbd>←</Kbd> <Kbd>→</Kbd> while playing. Positive means the video runs late — use it when
        there's a title card before the music.
      </Text>

      <Box borderTopWidth="1px" borderColor="var(--tt-border)" mt={3} pt={3}>
        {calibrating ? (
          <Stack gap={2}>
            <Text fontSize="sm" color="var(--tt-accent)">
              Press any key the moment the first line is sung.
            </Text>
            <Text fontSize="xs" color="var(--tt-muted)">
              “{track.lines[0]?.text.slice(0, 42) ?? ''}
              {(track.lines[0]?.text.length ?? 0) > 42 ? '…' : ''}” · <Kbd>Esc</Kbd> to cancel
            </Text>
            <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={cancelCalibration}>
              Cancel
            </Button>
          </Stack>
        ) : (
          <Flex gap={2} wrap="wrap">
            <Button size="xs" variant="outline" onClick={armCalibration}>
              Tap to calibrate
            </Button>
            {canShare && (
              <Button size="xs" colorPalette="blue" onClick={() => void share()}>
                Share this timing
              </Button>
            )}
          </Flex>
        )}

        <Text fontSize="xs" color="var(--tt-muted)" mt={2}>
          {shareState === 'shared'
            ? 'Shared — thank you. The next person to play this video gets your timing.'
            : shareState === 'sharing'
              ? 'Sharing…'
              : shareState === 'unavailable'
                ? 'This server has no shared timing store, so your correction stays local to this run.'
                : shareState === 'error'
                  ? (shareError ?? 'Could not share that timing.')
                  : status.note}
        </Text>
      </Box>
    </Box>
  );
}
