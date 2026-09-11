import { Badge, Text } from '@chakra-ui/react';
import type { LyricLine, SetlistTier } from '@shared/types';
import { analyzeDifficulty } from '@/lib/scoring/difficulty';

/**
 * How fast a song needs you to type, shown wherever a track is.
 *
 * The number is knowable before anything plays — it comes out of the LRC timings alone — so it can
 * sit on a search result and let someone choose a song by how hard it will be. That is also what
 * difficulty tiers will be graded on, so the label here and the tier there stay the same idea.
 */

/**
 * Colour per tier. The four graded ones run cool to hot, which is the ladder made visible.
 *
 * Freestyle is purple on purpose: it is off that scale entirely, and giving it a colour from the
 * sequence would imply it sits between two difficulties or beyond the last one.
 */
export const BAND_PALETTE: Record<SetlistTier, string> = {
  easy: 'green',
  medium: 'blue',
  hard: 'orange',
  insane: 'red',
  freestyle: 'purple',
};

export function PaceBadge({ lines, showBand = true }: { lines: LyricLine[]; showBand?: boolean }) {
  const { requiredWpm, band } = analyzeDifficulty(lines);
  if (requiredWpm <= 0) return null;

  return (
    <Badge colorPalette={BAND_PALETTE[band]} variant="subtle" title="Typing speed needed to keep up">
      ≈{Math.round(requiredWpm)} wpm{showBand ? ` · ${band}` : ''}
    </Badge>
  );
}

/** The same figure with its caveat spelled out, for screens with room for a sentence. */
export function PaceDetail({ lines }: { lines: LyricLine[] }) {
  const { requiredWpm, peakWpm, band } = analyzeDifficulty(lines);
  if (requiredWpm <= 0) return null;

  return (
    <Text fontSize="xs" color="var(--tt-muted)">
      Needs about <strong>{Math.round(requiredWpm)} wpm</strong> to land every line in time
      {peakWpm > requiredWpm * 1.2 && <> · up to {Math.round(peakWpm)} on its hardest stretch</>} ·{' '}
      {band}
    </Text>
  );
}
