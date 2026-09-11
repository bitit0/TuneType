import { Box, Stack, Text } from '@chakra-ui/react';
import type { LyricLine } from '@shared/types';
import { LINES_AHEAD, LINES_BEHIND } from '@/lib/scoring/constants';
import { TypingInput } from '@/components/Typing/TypingInput';

interface Props {
  lines: LyricLine[];
  activeIndex: number;
  typed: string;
  /** Time until the next line opens, in ms. Null once the song is under way on a line. */
  countdownMs: number | null;
}

/**
 * The play surface: a little context either side of the line being typed.
 *
 * Showing upcoming lines is a difficulty decision as much as a layout one — reading ahead is how a
 * player keeps pace with a fast section, so LINES_AHEAD is tuned in constants.ts alongside the
 * scoring tolerances rather than hard-coded here.
 */
export function LyricScroller({ lines, activeIndex, typed, countdownMs }: Props) {
  // Before the first line and in the gaps between lines there is nothing to type. That is a normal
  // state in a song with an intro or an instrumental break, not an error.
  if (activeIndex < 0) {
    return (
      <Stack align="center" justify="center" minH="180px" gap={3}>
        <Text color="var(--tt-muted)" fontSize="lg">
          {countdownMs !== null && countdownMs < 10_000
            ? `Next line in ${(countdownMs / 1000).toFixed(1)}s`
            : 'Waiting for the next line…'}
        </Text>
      </Stack>
    );
  }

  const from = Math.max(0, activeIndex - LINES_BEHIND);
  const to = Math.min(lines.length - 1, activeIndex + LINES_AHEAD);
  const window = [];
  for (let i = from; i <= to; i++) window.push(i);

  return (
    <Stack minH="180px" justify="center" gap={3}>
      {window.map((index) => {
        const line = lines[index]!;

        if (index === activeIndex) {
          return <TypingInput key={index} target={line.text} typed={typed} />;
        }

        return (
          <Box key={index} className="tt-context-line" opacity={index < activeIndex ? 0.4 : 0.7}>
            {line.text}
          </Box>
        );
      })}
    </Stack>
  );
}
