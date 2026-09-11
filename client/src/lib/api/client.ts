import { useAuthStore } from '@/store/authStore';

/**
 * Thin wrapper over `fetch` for our own API.
 *
 * Note what it is not used for: LRCLIB. That request goes straight from the browser to LRCLIB and
 * must keep doing so — routing lyrics through here would put them on our server, which is the one
 * thing the project's legal posture rules out.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Field-level detail from the server, when it sent any. */
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * True when this feature has no server behind it, rather than the server having gone wrong.
 *
 * 503 is the server saying so itself — no Firebase project, no API key. 404 means nothing answers
 * at that path at all, which is what a static deployment looks like: the client is served from a
 * CDN and there is no Express process anywhere. Both mean the same thing to a caller, which is to
 * offer the path that needs no server instead of an error.
 */
export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 503 || error.status === 404);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the caller's ID token. Anything under /api/account needs it. */
  auth?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, signal } = options;
  const headers: Record<string, string> = {};

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = await useAuthStore.getState().getIdToken();
    // A 401 from the server is the honest outcome here — better than inventing a client-side error
    // that doesn't match what the server would have said.
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) return undefined as T;

  // An error page from a proxy is HTML, not JSON; failing to parse it must not mask the status.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      (payload as { error?: string } | null)?.error ?? `Request failed (HTTP ${response.status}).`,
      response.status,
      (payload as { details?: string[] } | null)?.details,
    );
  }

  return payload as T;
}
