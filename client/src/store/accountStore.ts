import { create } from 'zustand';
import type {
  AccountOverview,
  PlayableTrack,
  ProfilePatch,
  RunSummary,
  SavedRun,
} from '@shared/types';
import { ApiError, isUnavailable } from '@/lib/api/client';
import * as api from '@/lib/api/account';

/**
 * Account state: profile, lifetime stats, history.
 *
 * The governing rule is that none of this is ever allowed to block play. Every failure path here
 * ends in a message and a shrug, never a thrown error that unmounts a screen — someone who just
 * finished a song should see their score whether or not it reached the cloud.
 */

type SaveState = 'idle' | 'saving' | 'saved' | 'unavailable' | 'error';

interface AccountState {
  overview: AccountOverview | null;
  loading: boolean;
  error: string | null;

  /** Where the most recent run save got to. Drives the one line of text on the results screen. */
  saveState: SaveState;
  saveError: string | null;
  lastSavedRun: SavedRun | null;

  load: (signal?: AbortSignal) => Promise<void>;
  /** Loads once per session. The header calls this on every page; refetching each time is waste. */
  loadIfNeeded: () => Promise<void>;
  saveRun: (
    track: PlayableTrack,
    videoId: string,
    offsetMs: number,
    summary: RunSummary,
  ) => Promise<void>;
  /** Applies a partial profile update. Returns false and sets `error` when it fails. */
  updateProfile: (patch: ProfilePatch) => Promise<boolean>;
  deleteAccount: () => Promise<boolean>;
  resetSaveState: () => void;
  clear: () => void;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server.';
}

export const useAccountStore = create<AccountState>((set, get) => ({
  overview: null,
  loading: false,
  error: null,
  saveState: 'idle',
  saveError: null,
  lastSavedRun: null,

  load: async (signal) => {
    set({ loading: true, error: null });
    try {
      set({ overview: await api.fetchOverview(signal), loading: false });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // A 503 carries the server's own explanation of what is missing — pass it through rather
      // than replacing it with a vaguer sentence of our own.
      set({ loading: false, error: messageFor(error) });
    }
  },

  loadIfNeeded: async () => {
    const { overview, loading } = get();
    if (overview || loading) return;
    await get().load();
  },

  saveRun: async (track, videoId, offsetMs, summary) => {
    // Nothing typed is nothing worth a document — and a zero-length run would drag a lifetime
    // average around for no reason.
    if (summary.linesAttempted === 0) {
      set({ saveState: 'idle' });
      return;
    }

    set({ saveState: 'saving', saveError: null });
    try {
      const { run, stats } = await api.postRun(
        api.toRunSubmission(track, videoId, offsetMs, summary),
      );

      // Patch the cached overview rather than refetching: the profile screen should already be
      // right by the time someone navigates to it.
      const overview = get().overview;
      set({
        saveState: 'saved',
        lastSavedRun: run,
        overview: overview
          ? { ...overview, stats, recentRuns: [run, ...overview.recentRuns].slice(0, 10) }
          : null,
      });
    } catch (error) {
      set({
        saveState: isUnavailable(error) ? 'unavailable' : 'error',
        saveError: messageFor(error),
      });
    }
  },

  updateProfile: async (patch) => {
    try {
      const profile = await api.updateProfile(patch);
      const overview = get().overview;
      // Only the profile changes; stats and history are untouched by a rename or a new picture.
      set({ overview: overview ? { ...overview, profile } : null, error: null });
      return true;
    } catch (error) {
      set({ error: messageFor(error) });
      return false;
    }
  },

  deleteAccount: async () => {
    try {
      await api.deleteAccount();
      set({ overview: null, lastSavedRun: null, saveState: 'idle' });
      return true;
    } catch (error) {
      set({ error: messageFor(error) });
      return false;
    }
  },

  resetSaveState: () => set({ saveState: 'idle', saveError: null }),

  // Called on sign-out: one account's history must never be visible under another's session.
  clear: () =>
    set({
      overview: null,
      error: null,
      loading: false,
      saveState: 'idle',
      saveError: null,
      lastSavedRun: null,
    }),
}));
