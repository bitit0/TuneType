import { describe, expect, it } from 'vitest';
import type { Keystroke } from '@shared/types';
import { keyErrorRates } from './keys';

function stroke(char: string, expected: string | null): Keystroke {
  return { char, expected, correct: char === expected, atMs: 0 };
}

describe('keyErrorRates', () => {
  it('ranks by miss count, so a single fluffed key does not top the list', () => {
    const ranked = keyErrorRates([
      // 'e' missed three times out of six.
      ...['e', 'e', 'e'].map((c) => stroke(c, 'e')),
      ...['r', 'r', 'r'].map((c) => stroke(c, 'e')),
      // 'z' missed on its only attempt — a 100% rate that means nothing.
      stroke('x', 'z'),
    ]);

    expect(ranked).toMatchObject([
      { key: 'e', misses: 3, attempts: 6, rate: 0.5 },
      { key: 'z', misses: 1, attempts: 1, rate: 1 },
    ]);
  });

  it('folds case, and counts a missed shift against the same key', () => {
    expect(keyErrorRates([stroke('a', 'A'), stroke('A', 'A'), stroke('a', 'a')])).toMatchObject([
      { key: 'a', attempts: 3, misses: 1 },
    ]);
  });

  it('drops keys never missed and strokes with nothing expected', () => {
    expect(keyErrorRates([stroke('a', 'a'), stroke('q', null)])).toEqual([]);
  });
});
