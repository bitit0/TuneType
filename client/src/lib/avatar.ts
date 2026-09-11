import type { AvatarColor, UserProfile } from '@shared/types';

/**
 * The generated avatar: a colored disc with the account's initials.
 *
 * Everything here is derived, never stored — a profile keeps a palette key, not a rendered image,
 * so restyling the app restyles every avatar with it.
 */

/**
 * Palette, as a total map over the shared union. Declaring it `Record<AvatarColor, …>` rather than
 * a loose object is what makes adding a color to the union a compile error here until it gets a
 * real value, instead of a silently missing entry that renders as a transparent hole.
 */
export const AVATAR_PALETTE: Record<AvatarColor, { bg: string; fg: string }> = {
  blue: { bg: '#3b5bdb', fg: '#eef2ff' },
  violet: { bg: '#6741d9', fg: '#f3f0ff' },
  teal: { bg: '#0c8599', fg: '#e6fcf5' },
  amber: { bg: '#b8860b', fg: '#fff9db' },
  rose: { bg: '#c2255c', fg: '#fff0f6' },
  lime: { bg: '#5c940d', fg: '#f4fce3' },
  slate: { bg: '#495057', fg: '#f1f3f5' },
};

export const AVATAR_COLOR_KEYS = Object.keys(AVATAR_PALETTE) as AvatarColor[];

/**
 * One or two letters standing in for a picture.
 *
 * Takes the first letter of the first two words, so "Ada Lovelace" reads as "AL" — noticeably more
 * distinguishable at 28px than a single letter, which is the size this is mostly seen at. Falls
 * back to the first two characters of a single-word name, and to "?" for a name made entirely of
 * characters with no uppercase form (which `toUpperCase` leaves as-is rather than mangling).
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Which image to actually show, in priority order.
 *
 * 1. A picture the user uploaded — an explicit choice, so it wins.
 * 2. The provider's photo, for Google accounts. Free, already correct, and means a Google user
 *    never sees a placeholder they didn't ask for. Not copied into our storage; rendered from
 *    their URL, so it stays current if they change it.
 * 3. Nothing — the caller draws initials on the profile's color.
 */
export function avatarSrc(
  profile: Pick<UserProfile, 'photo'> | null,
  providerPhotoUrl?: string | null,
): string | null {
  return profile?.photo ?? providerPhotoUrl ?? null;
}
