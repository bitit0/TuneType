import { describe, expect, it } from 'vitest';
import type { KeyTally, LrcTimeMs, LyricLine } from '@shared/types';
import { keyWeights, practiceFit } from './practice';

/** Fixtures are synthetic. Nothing in this repo is lyrics content, tests included. */
function line(text: string): LyricLine {
  return { startMs: 0 as LrcTimeMs, endMs: 1_000 as LrcTimeMs, text };
}

describe('keyWeights', () => {
  it('trusts a rate backed by evidence more than one backed by two attempts', () => {
    const tally: KeyTally = {
      // Half missed, but over two attempts. Should barely move off the baseline.
      q: { attempts: 2, misses: 1 },
      // A tenth missed, over a thousand. Should be believed.
      e: { attempts: 1_000, misses: 100 },
    };

    const { rate, baseline } = keyWeights(tally);

    expect(rate.get('e')).toBeCloseTo(0.1, 2);
    expect(rate.get('q')).toBeLessThan(0.25);
    // Shrunk toward the player's own average rather than toward zero.
    expect(rate.get('q')).toBeGreaterThan(baseline * 0.9);
  });

  it('ignores space, which is typed constantly and missed almost never', () => {
    const { rate } = keyWeights({ ' ': { attempts: 5_000, misses: 1 } });
    expect(rate.has(' ')).toBe(false);
  });

  it('reports a zero baseline for an account that has never typed', () => {
    expect(keyWeights({}).baseline).toBe(0);
  });
});

describe('practiceFit', () => {
  const weights = keyWeights({
    z: { attempts: 500, misses: 250 },
    a: { attempts: 500, misses: 5 },
  });

  it('ranks the song built from weak keys above the one built from strong keys', () => {
    const hard = practiceFit([line('zzzz zzzz')], weights);
    const easy = practiceFit([line('aaaa aaaa')], weights);

    expect(hard.load).toBeGreaterThan(easy.load);
    expect(hard.culprits[0]).toBe('z');
  });

  it('measures load per character, so length alone cannot win', () => {
    const short = practiceFit([line('zzzz')], weights);
    const long = practiceFit([line('aaaa'), line('aaaa'), line('aaaa')], weights);

    expect(short.load).toBeGreaterThan(long.load);
  });

  it('folds case, since a key is a key', () => {
    expect(practiceFit([line('ZZZZ')], weights).load).toBeCloseTo(
      practiceFit([line('zzzz')], weights).load,
      10,
    );
  });

  it('falls back to the baseline for keys never seen before', () => {
    // 'q' is absent from the tally entirely, so it is assumed to cost the player's average.
    const fit = practiceFit([line('qqqq')], weights);
    expect(fit.load).toBeCloseTo(weights.baseline, 10);
  });

  it('returns nothing to act on for an empty song', () => {
    expect(practiceFit([], weights)).toEqual({ load: 0, culprits: [] });
  });
});
