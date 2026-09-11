import { useState } from 'react';
import { Box, Button, Flex, Image, Spinner, Text } from '@chakra-ui/react';
import type { SetlistEntry, SetlistTier } from '@shared/types';
import { moveInSetlist, removeFromSetlist, thumbnailUrl } from '@/lib/api/setlists';
import { LADDER, formatDuration } from './tiers';

/**
 * One curated song, as a row: thumbnail, title, the pace it demands, and the curator's controls.
 *
 * Shared by the setlists index and the per-tier pages, which is why it moved out of the index
 * route. Sized for a column rather than a full-width row — see the stacked stats below.
 */
export function EntryCard({
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
            w="96px"
            h="54px"
            objectFit="cover"
            flexShrink={0}
            bg="var(--tt-border)"
          />

          {/*
            Stacked rather than spread across the row. In a column this narrow there is no room for
            a right-hand stats block beside the title without truncating both.
          */}
          <Box py={2} pe={2} minW={0} flex="1">
            <Text fontWeight="semibold" truncate>
              {entry.title}
            </Text>
            <Text fontSize="sm" color="var(--tt-muted)" truncate>
              {entry.artist}
            </Text>
            <Text fontSize="xs" color="var(--tt-muted)" truncate>
              ≈{Math.round(entry.requiredWpm)} wpm · {formatDuration(entry.durationSec)} ·{' '}
              {entry.lineCount} lines
            </Text>
          </Box>

          {busy && (
            <Flex align="center" pe={3} flexShrink={0}>
              <Spinner size="sm" />
            </Flex>
          )}
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
