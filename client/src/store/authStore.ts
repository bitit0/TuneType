import { create } from 'zustand';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isAuthConfigured } from '@/lib/firebase';

interface AuthState {
  user: User | null;
  /** True until the first auth state callback arrives, so the header doesn't flash "sign in". */
  initializing: boolean;
  error: string | null;

  init: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  clearError: () => void;
  /**
   * Bearer token for API calls, or null when signed out. Used by every /api/account request.
   * Firebase refreshes an expired token here, so callers can treat it as always current.
   */
  getIdToken: () => Promise<string | null>;
}

/**
 * Firebase error codes are precise but unreadable; map the ones a user can actually cause.
 *
 * Two kinds of failure land here and they need different messages. Some are the user's to fix (a
 * wrong password), but the popup ones are usually *ours* — a provider left disabled in the console,
 * a domain not on the allowlist. Those used to fall through to "Sign-in failed. Please try again.",
 * which is actively misleading: retrying cannot help, and the message hides the one fact that would
 * let anyone fix it. Setup failures now name the console page to go to.
 */
function readableError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';

  // Always log the raw code. The popup closes on its own, so without this there is nothing left to
  // diagnose from — no failed request in the network tab, no error in the console, just a window
  // that blinked.
  console.error(`[auth] ${code || 'unknown error'}`, error);

  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email — try signing in instead.';
    case 'auth/weak-password':
      return 'Password needs to be at least 6 characters.';

    // --- Setup problems. The popup opens, fails against the auth handler, and closes itself. ---
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this Firebase project. Enable it under Authentication → Sign-in method in the Firebase console.';
    case 'auth/unauthorized-domain':
      return `${window.location.hostname} is not an authorized domain for this Firebase project. Add it under Authentication → Settings → Authorized domains.`;
    case 'auth/configuration-not-found':
      return 'This Firebase project has no Authentication configuration. Enable Authentication in the console, then enable a sign-in provider.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid-please-pass-a-valid-api-key':
      return 'VITE_FIREBASE_API_KEY is not valid for this project. Check it against the Firebase console, then restart the dev server.';

    // --- Browser-level popup problems. ---
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site, or use email sign-in below.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in window closed before it finished. If you did not close it, check the browser console for the underlying error.';
    case 'auth/cancelled-popup-request':
      // Benign: a second popup superseded the first. Not worth alarming anyone about.
      return '';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection.';

    default:
      // Unmapped codes still surface the code itself — a searchable string beats a dead end.
      return code
        ? `Sign-in failed (${code}). See the browser console for details.`
        : 'Sign-in failed. See the browser console for details.';
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initializing: isAuthConfigured(),
  error: null,

  init: () => {
    const auth = getFirebaseAuth();
    if (!auth) {
      set({ initializing: false });
      return;
    }
    onAuthStateChanged(auth, (user) => set({ user, initializing: false }));
  },

  signInWithGoogle: async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      set({ error: null });
    } catch (error) {
      // An empty message means the failure was benign (a superseded popup); don't show anything.
      const message = readableError(error);
      set({ error: message || null });
    }
  },

  signInWithEmail: async (email, password) => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      set({ error: null });
    } catch (error) {
      set({ error: readableError(error) });
    }
  },

  registerWithEmail: async (email, password) => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      set({ error: null });
    } catch (error) {
      set({ error: readableError(error) });
    }
  },

  logOut: async () => {
    const auth = getFirebaseAuth();
    if (auth) await signOut(auth);
  },

  clearError: () => set({ error: null }),

  getIdToken: async () => {
    const auth = getFirebaseAuth();
    return auth?.currentUser ? auth.currentUser.getIdToken() : null;
  },
}));
