import type { OffsetConsensus } from '@shared/types';
import { apiFetch } from './client';

/**
 * Typed calls against /api/offsets.
 *
 * Sent with auth when there is a session and without when there is not, and both are fine. The
 * server attributes a signed-in submission so it can replace that person's earlier measurement
 * rather than counting both; a guest's is simply one more anonymous vote. Requiring an account
 * would make the store's coverage depend on sign-ups, and coverage is the whole point.
 */

export function fetchConsensus(
  videoId: string,
  lrclibId: number,
  signal?: AbortSignal,
): Promise<OffsetConsensus> {
  return apiFetch<OffsetConsensus>(
    `/api/offsets/${encodeURIComponent(videoId)}/${lrclibId}`,
    { auth: true, signal },
  );
}

export function submitOffset(input: {
  videoId: string;
  lrclibId: number;
  offsetMs: number;
  source: 'tap' | 'nudge';
}): Promise<OffsetConsensus> {
  return apiFetch<OffsetConsensus>('/api/offsets', {
    method: 'POST',
    body: { ...input, offsetMs: Math.round(input.offsetMs) },
    auth: true,
  });
}
