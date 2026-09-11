import { useEffect, useRef, useState } from 'react';
import type { LyricLine } from '@shared/types';
import { findActiveLineIndex } from '@/lib/lrclib/parseLrc';
import type { VirtualClock } from './VirtualClock';
import { lyricTimeFor } from './offset';
import { useSessionStore } from '@/store/sessionStore';
import { OFFSET_NUDGE_STEP_MS } from '@/lib/scoring/constants';

/**
 * Drives the play screen: samples the clock every frame, but only pushes to React when something
 * discrete actually changes.
 *
 * That distinction is the whole design. The clock moves continuously at 60fps; the active line
 * changes a few times a minute. Rendering on the former would burn a React pass per frame for a
 * result that is usually identical, so the loop reads from a ref and calls setState only on a
 * genuine transition.
 */
export function useGameLoop(lines: LyricLine[], clockRef: React.RefObject<VirtualClock | null>) {
  const setActiveLine = useSessionStore((s) => s.setActiveLine);
  const typeChar = useSessionStore((s) => s.typeChar);
  const backspace = useSessionStore((s) => s.backspace);
  const nudgeOffset = useSessionStore((s) => s.nudgeOffset);
  const calibrateFromTap = useSessionStore((s) => s.calibrateFromTap);
  const cancelCalibration = useSessionStore((s) => s.cancelCalibration);

  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  // Read inside event handlers without making them stale or re-subscribing on every change.
  const offsetRef = useRef(0);
  offsetRef.current = useSessionStore((s) => s.offsetMs);

  const linesRef = useRef(lines);
  linesRef.current = lines;

  const calibratingRef = useRef(false);
  calibratingRef.current = useSessionStore((s) => s.calibrating);

  /** Offset-adjusted playback time — the single expression everything else is measured against. */
  const displayTime = () => lyricTimeFor(clockRef.current?.now() ?? 0, offsetRef.current);

  useEffect(() => {
    let frame = 0;
    let lastIndex = -2;
    let lastCountdownBucket = -1;

    const tick = () => {
      const now = displayTime();
      const index = findActiveLineIndex(linesRef.current, now);

      if (index !== lastIndex) {
        lastIndex = index;
        setActiveLine(index);
      }

      // Between lines, show how long until the next one. Bucketed to 100ms so the countdown
      // re-renders ten times a second rather than sixty.
      if (index < 0) {
        const next = linesRef.current.find((line) => line.startMs > now);
        const remaining = next ? next.startMs - now : null;
        const bucket = remaining === null ? -1 : Math.floor(remaining / 100);
        if (bucket !== lastCountdownBucket) {
          lastCountdownBucket = bucket;
          setCountdownMs(remaining);
        }
      } else if (lastCountdownBucket !== -1) {
        lastCountdownBucket = -1;
        setCountdownMs(null);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockRef, setActiveLine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never swallow keys aimed at a real input (the offset field, a sign-in form).
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      /*
       * Tap calibration takes over the keyboard entirely while it is armed.
       *
       * It is handled here rather than by the panel that offers it because this is already the
       * only place keystrokes are interpreted, and two window-level key listeners racing over the
       * same press — one to time the tap, one to type it into the lyric — is a bug waiting to be
       * written. Any key taps, so the player can hit whatever is under their hand at the moment
       * they hear the line; Escape backs out.
       */
      if (calibratingRef.current) {
        event.preventDefault();
        if (event.key === 'Escape') {
          cancelCalibration();
          return;
        }
        calibrateFromTap(clockRef.current?.now() ?? 0);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        nudgeOffset(-OFFSET_NUDGE_STEP_MS);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        nudgeOffset(OFFSET_NUDGE_STEP_MS);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
        return;
      }

      // Printable characters only — `key` is a single code point for those and a word for
      // everything else ("Shift", "Enter", "F5").
      if (Array.from(event.key).length === 1) {
        event.preventDefault();
        typeChar(event.key, displayTime());
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [typeChar, backspace, nudgeOffset, calibrateFromTap, cancelCalibration, clockRef]);

  return { countdownMs, displayTime };
}
