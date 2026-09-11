import type { SetlistTier } from '@shared/types';

/**
 * The tiers, their names and what each one is for.
 *
 * Lives here rather than in a route because two pages render it now — the setlists index and each
 * tier's own page — and a second copy of the blurbs would drift from the first.
 */
export const TIERS: ReadonlyArray<{ tier: SetlistTier; label: string; blurb: string }> = [
  { tier: 'easy', label: 'Easy', blurb: 'Room to think between lines. Where to start.' },
  { tier: 'medium', label: 'Medium', blurb: 'A conversational pace, sustained.' },
  { tier: 'hard', label: 'Hard', blurb: 'Little slack. Mistakes start costing lines.' },
  { tier: 'insane', label: 'Insane', blurb: 'Dense, fast, and unforgiving.' },
  {
    tier: 'freestyle',
    label: 'Freestyle',
    blurb: 'Off the ladder — songs kept for their own sake rather than for where they rank.',
  },
];

/** The graded ladder. Freestyle is excluded, so the move controls cannot walk a song onto it. */
export const LADDER = TIERS.filter((entry) => entry.tier !== 'freestyle');

export function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
