import { describe, it, expect } from 'vitest';
import { AVATAR_COLOR_KEYS, AVATAR_PALETTE, avatarSrc, initialsFor } from './avatar';

describe('initialsFor', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
    expect(initialsFor('Ada Byron Lovelace')).toBe('AB');
  });

  it('takes two letters from a single-word name', () => {
    expect(initialsFor('ada')).toBe('AD');
  });

  it('handles a one-character name', () => {
    expect(initialsFor('a')).toBe('A');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(initialsFor('   ada   lovelace  ')).toBe('AL');
  });

  it('falls back rather than rendering nothing', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });

  it('leaves scripts without case alone instead of mangling them', () => {
    // toUpperCase is a no-op here; the point is that it returns letters, not an empty string.
    expect(initialsFor('あかり')).toBe('あか');
  });
});

describe('avatarSrc', () => {
  const uploaded = 'data:image/webp;base64,AAAA';
  const google = 'https://lh3.googleusercontent.com/a/example';

  it('prefers the picture the user uploaded', () => {
    expect(avatarSrc({ photo: uploaded }, google)).toBe(uploaded);
  });

  it('falls back to the provider photo', () => {
    expect(avatarSrc({ photo: null }, google)).toBe(google);
  });

  it('returns null when there is no picture at all, so initials are drawn', () => {
    expect(avatarSrc({ photo: null }, null)).toBeNull();
    expect(avatarSrc(null, undefined)).toBeNull();
  });
});

describe('AVATAR_PALETTE', () => {
  it('gives every key a background and a foreground', () => {
    for (const key of AVATAR_COLOR_KEYS) {
      expect(AVATAR_PALETTE[key].bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(AVATAR_PALETTE[key].fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('is not empty, so the color picker always has something to show', () => {
    expect(AVATAR_COLOR_KEYS.length).toBeGreaterThan(0);
  });
});
