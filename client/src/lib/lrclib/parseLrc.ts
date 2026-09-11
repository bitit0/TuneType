import type { LyricLine, LrcTimeMs } from '@shared/types';

/**
 * Parses LRC text into timed lines.
 *
 * The content parsed here comes from LRCLIB at play time, is held in memory for the duration of a
 * run, and is never persisted anywhere. Tests for this module use synthetic fixtures.
 *
 * Handles the parts of the format that actually show up in the wild:
 *  - `[mm:ss.xx]` and `[mm:ss.xxx]` and bare `[mm:ss]`
 *  - several timestamps on one line (a repeated chorus line), which expand into separate entries
 *  - metadata tags (`[ar:]`, `[ti:]`, `[length:]`) which are skipped
 *  - blank or whitespace-only lyric lines, which are dropped — they're gaps, not typing targets
 *  - lines arriving out of order, which are sorted
 *  - parenthesised backing vocals, which are removed — see `stripParentheticals`
 */

/** Matches one `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss.xxx]` tag. */
const TIME_TAG = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;

/**
 * How long the final line's window stays open. It has no successor to bound it, and LRC files
 * rarely mark the end of the last line, so we give it a fixed tail.
 */
export const FINAL_LINE_TAIL_MS = 5_000;

/**
 * Removes parenthesised passages from a lyric line.
 *
 * LRC files put backing vocals, ad-libs and answering phrases in brackets — "I keep on falling
 * (falling)", "(ooh, ooh)". They are sung by someone else, they are usually repeats of the word
 * just typed, and typing them is busywork that also wrecks the pace: a line's window is set by the
 * lead vocal, and the ad-lib's characters come out of the same budget.
 *
 * Only balanced pairs are removed, innermost first so nesting is handled. An unclosed bracket is
 * left alone deliberately — treating it as "delete to end of line" would swallow real lyrics on
 * the strength of one stray character.
 *
 * A line that was nothing but an ad-lib becomes empty here, and the parser then drops it the same
 * way it drops a blank line.
 */
export function stripParentheticals(text: string): string {
  let out = text;

  // Innermost-first, repeatedly, so "(a (b) c)" collapses fully rather than leaving ragged halves.
  for (;;) {
    const next = out.replace(/\([^()]*\)/g, ' ');
    if (next === out) break;
    out = next;
  }

  return out
    // Removing "(yeah)" from "you (yeah), tonight" would otherwise leave a space before the comma.
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFraction(raw: string | undefined): number {
  if (!raw) return 0;
  // ".5" means 500ms, ".05" means 50ms, ".050" also means 50ms — pad to milliseconds.
  return Number(raw.padEnd(3, '0'));
}

export function parseLrc(lrc: string): LyricLine[] {
  const entries: Array<{ startMs: number; text: string }> = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0;

    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastTagEnd = 0;

    while ((match = TIME_TAG.exec(rawLine)) !== null) {
      // Only leading timestamps count. A `[...]` appearing after the text has started is part of
      // the lyric, not a cue.
      if (match.index !== lastTagEnd) break;
      lastTagEnd = match.index + match[0].length;

      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      stamps.push(minutes * 60_000 + seconds * 1_000 + parseFraction(match[3]));
    }

    if (stamps.length === 0) continue; // metadata tag or junk

    const text = stripParentheticals(rawLine.slice(lastTagEnd));
    // Empty either because the line was a gap marker, or because it was entirely backing vocal.
    if (text.length === 0) continue;

    for (const startMs of stamps) entries.push({ startMs, text });
  }

  entries.sort((a, b) => a.startMs - b.startMs);

  return entries.map((entry, i) => {
    const next = entries[i + 1];
    const endMs = next ? next.startMs : entry.startMs + FINAL_LINE_TAIL_MS;
    return {
      startMs: entry.startMs as LrcTimeMs,
      // Guard against duplicate timestamps producing a zero- or negative-length window.
      endMs: Math.max(endMs, entry.startMs + 1) as LrcTimeMs,
      text: entry.text,
    };
  });
}

/**
 * Index of the line whose window contains `timeMs`, or -1 before the first line starts.
 *
 * Binary search because this runs inside the animation frame loop.
 */
export function findActiveLineIndex(lines: LyricLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid]!;
    if (timeMs < line.startMs) {
      hi = mid - 1;
    } else if (timeMs >= line.endMs) {
      lo = mid + 1;
    } else {
      found = mid;
      break;
    }
  }

  return found;
}
