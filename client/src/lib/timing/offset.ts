/**
 * The offset sign convention, in one place, because getting it backwards is invisible.
 *
 * A wrong sign does not throw. It shifts the lyrics the wrong way, which looks exactly like the
 * video needing a correction in the first place — so the user "fixes" it by nudging twice as far
 * in the other direction and everything appears to work. It only becomes undeniable when those
 * values are shared: an offset store where half the submitters used one convention and half used
 * the other has no consensus to find.
 *
 * The convention, matching PROJECT_CONTEXT:
 *
 *   **A positive offset means the video runs late relative to its lyrics.**
 *
 * That is the common case and the intuitive one — a title card, a label ident, or a few seconds of
 * silence before the music starts. The audio for a given lyric arrives at a *later* video time
 * than the LRC file says, so the lyric must be held back to meet it.
 */

/**
 * Where in the LRC timeline a given moment of video sits.
 *
 * Everything the game compares — which line is active, when a keystroke landed — happens in LRC
 * time, so this is the conversion the whole play screen runs through.
 */
export function lyricTimeFor(videoTimeMs: number, offsetMs: number): number {
  return videoTimeMs - offsetMs;
}

/**
 * The offset implied by tapping along.
 *
 * The player presses a key at the moment they hear a line begin. The video clock says when that
 * was; the LRC file says when it should have been. The gap between them is the correction.
 */
export function offsetFromTap(observedVideoTimeMs: number, lrcTimestampMs: number): number {
  return observedVideoTimeMs - lrcTimestampMs;
}
