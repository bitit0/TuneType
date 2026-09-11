import { describe, it, expect } from 'vitest';
import { parseLrc, findActiveLineIndex, FINAL_LINE_TAIL_MS } from './parseLrc';

// All fixtures below are invented placeholder text. Real lyrics never enter this repo.

describe('parseLrc', () => {
  it('parses centisecond and millisecond timestamps', () => {
    const lines = parseLrc(['[00:10.50]alpha', '[00:12.05]bravo', '[00:14.500]charlie'].join('\n'));

    expect(lines.map((l) => l.startMs)).toEqual([10_500, 12_050, 14_500]);
    expect(lines.map((l) => l.text)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('parses a bare [mm:ss] timestamp with no fraction', () => {
    expect(parseLrc('[01:05]delta')[0]!.startMs).toBe(65_000);
  });

  it('handles minute values above 59', () => {
    expect(parseLrc('[100:00]echo')[0]!.startMs).toBe(6_000_000);
  });

  it('skips metadata tags', () => {
    const lines = parseLrc(
      ['[ar:Placeholder Artist]', '[ti:Placeholder Title]', '[length:03:12]', '[00:01.00]foxtrot'].join('\n'),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('foxtrot');
  });

  it('drops timestamped lines with no text — those are instrumental gaps, not typing targets', () => {
    const lines = parseLrc(['[00:01.00]golf', '[00:05.00]', '[00:09.00]   ', '[00:12.00]hotel'].join('\n'));

    expect(lines.map((l) => l.text)).toEqual(['golf', 'hotel']);
  });

  it('expands a line carrying several timestamps into one entry each', () => {
    const lines = parseLrc('[00:10.00][01:20.00][02:30.00]india');

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.startMs)).toEqual([10_000, 80_000, 150_000]);
    expect(new Set(lines.map((l) => l.text))).toEqual(new Set(['india']));
  });

  it('sorts lines that arrive out of order', () => {
    const lines = parseLrc(['[00:30.00]kilo', '[00:10.00]juliett', '[00:20.00]lima'].join('\n'));

    expect(lines.map((l) => l.text)).toEqual(['juliett', 'lima', 'kilo']);
  });

  it('derives each window end from the next line start', () => {
    const lines = parseLrc(['[00:10.00]mike', '[00:14.00]november'].join('\n'));

    expect(lines[0]!.endMs).toBe(14_000);
  });

  it('gives the final line a fixed tail, since nothing bounds it', () => {
    const lines = parseLrc(['[00:10.00]oscar', '[00:14.00]papa'].join('\n'));

    expect(lines[1]!.endMs).toBe(14_000 + FINAL_LINE_TAIL_MS);
  });

  it('never produces a zero-length window when two lines share a timestamp', () => {
    const lines = parseLrc(['[00:10.00]quebec', '[00:10.00]romeo'].join('\n'));

    for (const line of lines) expect(line.endMs).toBeGreaterThan(line.startMs);
  });

  it('treats a bracket after the text as lyric content, not a cue', () => {
    const lines = parseLrc('[00:10.00]sierra [00:20.00] tango');

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('sierra [00:20.00] tango');
  });

  it('returns nothing for unsynced or empty input', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc('uniform\nvictor\nwhiskey')).toEqual([]);
  });
});

describe('findActiveLineIndex', () => {
  const lines = parseLrc(['[00:10.00]xray', '[00:14.00]yankee', '[00:18.00]zulu'].join('\n'));

  it('returns -1 before the first line opens', () => {
    expect(findActiveLineIndex(lines, 0)).toBe(-1);
    expect(findActiveLineIndex(lines, 9_999)).toBe(-1);
  });

  it('finds the line whose window contains the time', () => {
    expect(findActiveLineIndex(lines, 10_000)).toBe(0);
    expect(findActiveLineIndex(lines, 13_999)).toBe(0);
    expect(findActiveLineIndex(lines, 14_000)).toBe(1);
    expect(findActiveLineIndex(lines, 18_500)).toBe(2);
  });

  it('returns -1 once the final window has closed', () => {
    expect(findActiveLineIndex(lines, 18_000 + FINAL_LINE_TAIL_MS + 1)).toBe(-1);
  });

  it('returns -1 for an empty lyric set', () => {
    expect(findActiveLineIndex([], 1_000)).toBe(-1);
  });
});
