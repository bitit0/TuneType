import { expect, test, type Page } from '@playwright/test';

/**
 * The path from an empty search box to a loaded run.
 *
 * This is the one thing the unit suite structurally cannot check. It has the LRC parser, the video
 * matcher, the scoring and the ranking each under test in isolation, and none of that says whether
 * searching actually reaches the matcher, or whether what the matcher returns actually reaches the
 * player. That wiring is what breaks when a store field is renamed or a route is remounted, and it
 * breaks silently.
 *
 * Everything external is intercepted. The fixtures below are invented — an invented band, an
 * invented song, invented lyrics — because nothing in this repository is lyrics content and a test
 * file is not an exception to that.
 */

const VIDEO_ID = 'aaaaaaaaaaa';
const VIDEO_TITLE = 'Nineteen Hollows - Paper Ladder (Official Audio)';

/** Slightly shorter than the video, as a real track is: the upload carries a little tail. */
const TRACK_DURATION_SEC = 195;
const VIDEO_DURATION_SEC = 200;

const SYNCED_LYRICS = ['[00:01.00] aaa bbb ccc', '[00:05.00] ddd eee fff', '[00:09.00] ggg hhh'].join(
  '\n',
);

async function stubEverythingExternal(page: Page) {
  // Search is configured, so the home page offers its search box rather than handing over to the
  // song-first flow.
  await page.route('**/api/youtube/status', (route) =>
    route.fulfill({
      json: { configured: true, quota: { used: 0, budget: 80, day: '2026-01-01' } },
    }),
  );

  await page.route('**/api/youtube/videos*', (route) =>
    route.fulfill({
      json: {
        videos: [
          {
            videoId: VIDEO_ID,
            title: VIDEO_TITLE,
            channelTitle: 'Nineteen Hollows',
            durationSec: VIDEO_DURATION_SEC,
          },
        ],
        cached: true,
        quota: { used: 0, budget: 80, day: '2026-01-01' },
      },
    }),
  );

  /*
   * LRCLIB is called straight from the browser, never through our server, so this is where it is
   * intercepted. The entry has to survive both filters the client applies: synced, non-instrumental
   * lyrics that parse, and a title and length close enough to the video to be matched to it.
   */
  await page.route('**/lrclib.net/api/search*', (route) =>
    route.fulfill({
      json: [
        {
          id: 4242,
          trackName: 'Paper Ladder',
          artistName: 'Nineteen Hollows',
          albumName: 'Invented Record',
          duration: TRACK_DURATION_SEC,
          instrumental: false,
          syncedLyrics: SYNCED_LYRICS,
          plainLyrics: 'aaa bbb ccc',
        },
      ],
    }),
  );

  // The player and the auth SDK both reach for third parties the moment they load. Neither is what
  // is under test, and letting them out makes the suite depend on someone else's uptime.
  await page.route('**://www.youtube.com/**', (route) => route.abort());
  await page.route('**googleapis.com/**', (route) => route.abort());
  await page.route('**identitytoolkit**', (route) => route.abort());
}

test.beforeEach(async ({ page }) => {
  await stubEverythingExternal(page);
});

test('search a video, and the lyrics are matched to it', async ({ page }) => {
  await page.goto('/');

  // The search box is the focal point of the page and should be ready to type into on arrival.
  const search = page.getByPlaceholder('Artist and song');
  await expect(search).toBeFocused();

  await search.fill('Nineteen Hollows Paper Ladder');
  await page.getByRole('button', { name: 'Search' }).click();

  const result = page.getByText(VIDEO_TITLE);
  await expect(result).toBeVisible();

  await result.click();

  /*
   * Reaching /play is the assertion. Getting here means the video's title was parsed into an artist
   * and a song, LRCLIB was searched for that, the returned entry passed both the title and the
   * duration check, and the result was put into the session store under a shape the play route
   * accepts. Any one of those failing leaves the page where it was.
   */
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByRole('heading', { name: 'Paper Ladder' })).toBeVisible();

  /*
   * The required pace proves the LRC was parsed rather than merely fetched: it is derived from the
   * line timings, and the component renders nothing at all when that derivation yields zero.
   *
   * The lyric lines themselves are deliberately not asserted on. Nothing is playing — the video is
   * blocked — so no line is active yet, and the scroller shows its waiting state by design.
   */
  await expect(page.getByText(/Needs about \d+ wpm/)).toBeVisible();
});

test('a video whose lyrics cannot be found offers the song-first flow instead', async ({ page }) => {
  // LRCLIB knows nothing about it. An ordinary outcome, not an error.
  await page.route('**/lrclib.net/api/search*', (route) => route.fulfill({ json: [] }));

  await page.goto('/');
  await page.getByPlaceholder('Artist and song').fill('Nineteen Hollows Paper Ladder');
  await page.getByRole('button', { name: 'Search' }).click();

  await page.getByText(VIDEO_TITLE).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByText(/No synced lyrics on LRCLIB match/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search by song instead' })).toBeVisible();
});

test('the header paints above the home page backdrop', async ({ page }) => {
  /*
   * A regression guard with a specific history. The home page's fixed aurora is a positioned
   * element and the header was static, so the aurora painted over it completely — the nav sat in
   * the DOM at full opacity and was invisible on screen.
   *
   * The obvious probe does not work here, and it is worth saying why. `elementFromPoint` ignores
   * anything with `pointer-events: none`, which the aurora has, so hit-testing happily reports the
   * header on top while the screen shows otherwise. That gap is exactly why every DOM assertion
   * kept passing while the header was invisible.
   *
   * So this checks the stacking rule directly: while a page-level fixed backdrop exists, the header
   * has to be positioned and outrank it.
   */
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'TuneType' })).toBeVisible();

  const stacking = await page.evaluate(() => {
    const aurora = document.querySelector('.tt-aurora');
    const header = document.querySelector('header');
    const main = document.querySelector('main');
    if (!aurora || !header || !main) return null;

    const read = (el: Element) => {
      const style = getComputedStyle(el);
      return { position: style.position, zIndex: Number(style.zIndex) || 0 };
    };

    // The page's own content layer, which lifts itself above the aurora and so competes with the
    // header. Deepest positioned descendant with a z-index is close enough for this check.
    const content = [...main.querySelectorAll<HTMLElement>('*')]
      .map(read)
      .filter((s) => s.position !== 'static' && s.zIndex > 0);

    return { aurora: read(aurora), header: read(header), content };
  });

  expect(stacking).not.toBeNull();

  // Static content always loses to a positioned sibling, however early it appears in the document.
  expect(stacking!.header.position).not.toBe('static');
  expect(stacking!.header.zIndex).toBeGreaterThan(stacking!.aurora.zIndex);

  /*
   * And above the page's content layer, which the first version of this test did not check.
   *
   * Positioning the header opened a stacking context, so the account dropdown's own z-index stopped
   * competing globally and the header started competing with page content as one unit. At equal
   * z-index the later element in the document wins, and the dropdown rendered underneath the page —
   * visible, and swallowing every click aimed at it.
   */
  for (const layer of stacking!.content) {
    expect(stacking!.header.zIndex).toBeGreaterThan(layer.zIndex);
  }
});

test('the footer sits at the bottom of a short page, not in the middle of it', async ({ page }) => {
  /*
   * On a tall screen the home page does not fill the viewport, and the footer used to stop wherever
   * the content did — floating halfway up with dead space beneath it.
   *
   * The cause was a percentage min-height on the app shell. #root is a flex column with
   * `min-height: 100dvh`, and a percentage min-height resolves against a parent's *height*, which
   * #root never sets — so the shell took its content's height and `main` had nothing to grow into.
   *
   * A viewport taller than the content is the only place this is visible, hence the explicit size.
   */
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto('/');

  await expect(page.getByPlaceholder('Artist and song')).toBeVisible();

  const footer = page.locator('footer');
  await expect(footer).toBeVisible();

  const box = await footer.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();

  // Within a pixel of the bottom edge, rather than wherever the cards happened to end.
  expect(Math.abs(viewport!.height - (box!.y + box!.height))).toBeLessThan(2);
});
