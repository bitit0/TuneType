import { describe, it, expect } from 'vitest';
import { parseVideoId } from './parseVideoId';

const ID = 'dQw4w9WgXcQ';

describe('parseVideoId', () => {
  it('accepts a bare id', () => {
    expect(parseVideoId(ID)).toBe(ID);
  });

  it('accepts a standard watch url', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`http://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('accepts a youtu.be short link', () => {
    expect(parseVideoId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it('accepts embed, shorts, v and live paths', () => {
    expect(parseVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it('ignores extra query params like timestamps and playlists', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/watch?list=PL123&v=${ID}&index=4`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}?t=90`)).toBe(ID);
  });

  it('tolerates a missing scheme and surrounding whitespace', () => {
    expect(parseVideoId(`  youtube.com/watch?v=${ID}  `)).toBe(ID);
  });

  it('rejects non-youtube hosts', () => {
    expect(parseVideoId(`https://vimeo.com/watch?v=${ID}`)).toBeNull();
    expect(parseVideoId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
  });

  it('rejects malformed ids and junk', () => {
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('   ')).toBeNull();
    expect(parseVideoId('tooshort')).toBeNull();
    expect(parseVideoId('waaaaaaytoolongtobeanid')).toBeNull();
    expect(parseVideoId('bad!chars!!')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/watch?v=tooshort')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/results?search_query=x')).toBeNull();
  });
});
