import { create } from 'zustand';
import type {
  Keystroke,
  LineResult,
  OffsetConsensus,
  PlayableTrack,
  RunSummary,
} from '@shared/types';
import { scoreLine, summarizeRun } from '@/lib/scoring/score';
import { offsetFromTap } from '@/lib/timing/offset';
import { OFFSET_LIMIT_MS, OFFSET_NUDGE_STEP_MS } from '@/lib/scoring/constants';

/** How the offset in force was arrived at. See `offsetSource`. */
export type OffsetSource = 'none' | 'consensus' | 'tap' | 'nudge';

const clampOffset = (ms: number) => Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, ms));

/**
 * State for one play-through.
 *
 * Note what is NOT here: the 60fps clock reading. The clock lives in a ref and is sampled inside
 * the animation frame; only genuinely discrete changes (the active line advancing, a key being
 * pressed) go through the store, so React renders on events rather than on frames.
 */

interface SessionState {
  track: PlayableTrack | null;
  videoId: string | null;

  /**
   * The curated entry this run belongs to, or null for a searched track.
   *
   * Present only when play started from a setlist, because that is the only case the server can
   * score: a curated entry carries a stored profile of line lengths and windows, and a searched one
   * does not. It is what decides whether a finished run has a leaderboard to go to.
   */
  setlistEntryId: string | null;

  /**
   * Timing correction in force, in the sign convention of `lib/timing/offset.ts`: positive means
   * the video runs late relative to its lyrics, as it does when there is a title card.
   */
  offsetMs: number;

  /**
   * Where the current offset came from.
   *
   * Tracked because it decides two things: whether there is anything worth offering to share (a
   * consensus value played back unchanged is not a new measurement), and how a submission should
   * be labelled, since a deliberate tap and a run of arrow-key nudges have different error
   * profiles.
   */
  offsetSource: OffsetSource;

  /** What the server knows about this pairing, or null before it has been asked. */
  consensus: OffsetConsensus | null;

  /** True while waiting for the player to tap along with the first line. */
  calibrating: boolean;

  activeLineIndex: number;
  typedByLine: Record<number, string>;
  completedAtByLine: Record<number, number>;
  /** Per-line keystroke bounds. These are the WPM denominator — see `lineTypingMs`. */
  firstKeystrokeAtByLine: Record<number, number>;
  lastKeystrokeAtByLine: Record<number, number>;
  keystrokes: Keystroke[];

  firstKeystrokeAtMs: number | null;
  lastKeystrokeAtMs: number | null;
  finished: boolean;

  beginRun: (track: PlayableTrack, videoId: string, setlistEntryId?: string | null) => void;
  setActiveLine: (index: number) => void;
  typeChar: (char: string, atMs: number) => void;
  backspace: () => void;
  nudgeOffset: (deltaMs: number) => void;
  setOffset: (ms: number) => void;
  /** Applies what the server knows, unless the player has already moved the offset themselves. */
  applyConsensus: (consensus: OffsetConsensus) => void;
  armCalibration: () => void;
  cancelCalibration: () => void;
  /** Takes a raw video-clock reading and turns it into an offset against the first line. */
  calibrateFromTap: (videoTimeMs: number) => void;
  finish: () => void;
  reset: () => void;
  summarize: () => RunSummary;
}

const initial = {
  track: null,
  videoId: null,
  setlistEntryId: null,
  offsetMs: 0,
  offsetSource: 'none' as OffsetSource,
  consensus: null,
  calibrating: false,
  activeLineIndex: -1,
  typedByLine: {} as Record<number, string>,
  completedAtByLine: {} as Record<number, number>,
  firstKeystrokeAtByLine: {} as Record<number, number>,
  lastKeystrokeAtByLine: {} as Record<number, number>,
  keystrokes: [] as Keystroke[],
  firstKeystrokeAtMs: null,
  lastKeystrokeAtMs: null,
  finished: false,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initial,

  beginRun: (track, videoId, setlistEntryId = null) =>
    set({ ...initial, track, videoId, setlistEntryId }),

  setActiveLine: (index) => {
    if (get().activeLineIndex === index) return;
    set({ activeLineIndex: index });
  },

  typeChar: (char, atMs) => {
    const {
      track,
      activeLineIndex,
      typedByLine,
      completedAtByLine,
      firstKeystrokeAtByLine,
      lastKeystrokeAtByLine,
      keystrokes,
    } = get();
    const line = track?.lines[activeLineIndex];
    if (!line) return; // between lines — nothing to type against

    const typed = typedByLine[activeLineIndex] ?? '';
    if (typed.length >= line.text.length) return; // line already full; ignore overtyping

    const expected = line.text[typed.length] ?? null;
    const next = typed + char;

    const patch: Partial<SessionState> = {
      typedByLine: { ...typedByLine, [activeLineIndex]: next },
      keystrokes: [...keystrokes, { char, expected, correct: char === expected, atMs }],
      firstKeystrokeAtMs: get().firstKeystrokeAtMs ?? atMs,
      lastKeystrokeAtMs: atMs,
      // Per-line bounds: the first stamp opens this line's typing clock, the latest closes it if
      // the line is never completed. Backspacing does not reopen either — time already spent on a
      // line stays spent.
      firstKeystrokeAtByLine:
        firstKeystrokeAtByLine[activeLineIndex] === undefined
          ? { ...firstKeystrokeAtByLine, [activeLineIndex]: atMs }
          : firstKeystrokeAtByLine,
      lastKeystrokeAtByLine: { ...lastKeystrokeAtByLine, [activeLineIndex]: atMs },
    };

    // Reaching the end of the line is what stamps its completion time — that stamp is the entire
    // input to the timing multiplier, so it must be the moment of the final keystroke.
    if (next.length === line.text.length && completedAtByLine[activeLineIndex] === undefined) {
      patch.completedAtByLine = { ...completedAtByLine, [activeLineIndex]: atMs };
    }

    set(patch);
  },

  backspace: () => {
    const { activeLineIndex, typedByLine } = get();
    const typed = typedByLine[activeLineIndex];
    if (!typed) return;

    set({ typedByLine: { ...typedByLine, [activeLineIndex]: typed.slice(0, -1) } });
  },

  nudgeOffset: (deltaMs) => {
    const { offsetMs, offsetSource } = get();
    set({
      offsetMs: clampOffset(offsetMs + deltaMs),
      // A nudge on top of a tap is still a tap being refined — the tap is what established the
      // value and is the more descriptive label for how it was arrived at.
      offsetSource: offsetSource === 'tap' ? 'tap' : 'nudge',
    });
  },

  setOffset: (ms) => set({ offsetMs: clampOffset(ms), offsetSource: 'nudge' }),

  applyConsensus: (consensus) => {
    const { offsetSource } = get();
    set({ consensus });

    // Never overwrite a correction the player made themselves. The consensus arrives from a
    // network call that can land at any moment, and having the lyrics jump out from under someone
    // who has just finished lining them up by hand would be worse than not having it at all.
    if (offsetSource !== 'none') return;
    if (consensus.consensusOffsetMs === null) return;

    set({ offsetMs: clampOffset(consensus.consensusOffsetMs), offsetSource: 'consensus' });
  },

  armCalibration: () => set({ calibrating: true }),
  cancelCalibration: () => set({ calibrating: false }),

  calibrateFromTap: (videoTimeMs) => {
    const { track } = get();
    const first = track?.lines[0];
    if (!first) {
      set({ calibrating: false });
      return;
    }

    set({
      offsetMs: clampOffset(offsetFromTap(videoTimeMs, first.startMs)),
      offsetSource: 'tap',
      calibrating: false,
    });
  },

  finish: () => set({ finished: true }),

  reset: () => set({ ...initial }),

  summarize: () => {
    const {
      track,
      typedByLine,
      completedAtByLine,
      firstKeystrokeAtByLine,
      lastKeystrokeAtByLine,
      firstKeystrokeAtMs,
      lastKeystrokeAtMs,
    } = get();
    if (!track) return summarizeRun([], 0);

    const results: LineResult[] = [];
    for (const [key, typed] of Object.entries(typedByLine)) {
      const index = Number(key);
      const line = track.lines[index];
      if (!line || typed.length === 0) continue;

      results.push(
        scoreLine({
          lineIndex: index,
          target: line.text,
          typed,
          completedAtMs: completedAtByLine[index] ?? null,
          firstKeystrokeAtMs: firstKeystrokeAtByLine[index] ?? null,
          lastKeystrokeAtMs: lastKeystrokeAtByLine[index] ?? null,
          windowStartMs: line.startMs,
          windowEndMs: line.endMs,
        }),
      );
    }

    results.sort((a, b) => a.lineIndex - b.lineIndex);

    // The span of the run, first keystroke to last. Reported for context; WPM is measured per line
    // inside summarizeRun, so the gaps this span includes don't count against typing speed.
    const elapsedMs =
      firstKeystrokeAtMs !== null && lastKeystrokeAtMs !== null
        ? lastKeystrokeAtMs - firstKeystrokeAtMs
        : 0;

    return summarizeRun(results, elapsedMs);
  },
}));

export { OFFSET_NUDGE_STEP_MS };
