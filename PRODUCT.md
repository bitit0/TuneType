# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: people who type, who find plain word-list trainers boring.** They are practising or
showing off typing speed, and the song is what makes the practice bearable. The measurements are
the point — WPM against what the song demanded, accuracy, and which keys they actually miss. The
music is the motivation, not the subject.

They arrive **cold and public**: TuneType is deployed for anyone to find, so a first-time visitor
has no prior knowledge of what it is, no account, and no reason to make one yet.

Playing requires a physical keyboard and audible audio on a desktop-class machine. That is a
property of the game, not a choice still open.

## Product Purpose

A browser typing game. A YouTube video plays, line-synced lyrics scroll in time with it, and the
player types each line as it is sung.

Success is a player finishing a song at the pace that song actually demanded, and being able to see
precisely where they fell short — which lines cost them, which keys they miss, and whether their
speed was fast *for that song*.

## Positioning

**The timing layer is the mechanism, and it is the part a neighbouring product cannot trivially
copy.** The YouTube player runs in a cross-origin iframe: no audio samples, no way to derive sync
automatically, and the only clock is `getCurrentTime()` updating in ~250ms steps. Driving lyrics
off it directly stutters visibly. TuneType anchors on the instants that value *changes* rather than
on every poll, and corrects drift by bending the clock's rate within ±2% instead of snapping it.

Two things compound on top of that:

- **Shared offset consensus.** A correctly matched video can still sit seconds off its lyrics
  because of a title card or a different master, and no matching improves that. Players measure it
  by ear; once one person calibrates a video-and-track pairing, everyone after inherits it. Videos
  whose measurements irreconcilably disagree are not a timing problem but evidence of the wrong
  recording, so they are demoted out of search — search improves itself from play.
- **Required WPM, known before a note plays.** Derived from LRC timings alone, so it costs nothing
  and can be shown on a search result. It is what makes "70 WPM" mean something: fast on a song
  that needed 50, behind on one that needed 90.

Typing trainers run on fixed corpora and cannot tell you how fast a song needs you to be. Lyric
sites do not measure typing.

## Operating Context

- Desktop or laptop, physical keyboard, audio on, single player, one song at a time.
- Public web deployment. Guests arrive with no account and must be able to play immediately.
- **Two ways in.** Video-first (search YouTube, lyrics matched automatically from the video's title
  and length) is the front door. Song-first at `/songs` (search LRCLIB, then choose a video for the
  track) is the fallback, and is the *only* flow on a server with no YouTube API key.
- Setlists offer curated, pre-verified songs in difficulty tiers. They ship empty and are curated by
  an admin named in server environment variables.
- External dependencies: LRCLIB for lyrics (called directly from the browser), the YouTube Data API
  for search (server-side, budgeted), the YouTube IFrame player, and Firebase for optional auth and
  storage.

## Capabilities and Constraints

**Built and working:** LRC parsing, the virtual clock and its debug overlay, lyric scrolling, typing
with accuracy and timing scoring, per-line and per-key result breakdowns, optional Firebase
accounts with saved runs and lifetime stats, quota-guarded YouTube search with ranking, tap
calibration and shared offset consensus, required-WPM difficulty analysis, and curated setlists.

**The binding technical ceiling is search quota.** A free Google project allows 10,000 units a day;
`search.list` costs 100. That is roughly **100 searches per day for everyone using the server
combined**, with no graceful degradation — past the limit the API returns 403 until midnight
Pacific. Public deployment makes this a genuine scaling limit rather than a personal budget, and it
is the constraint most likely to decide what future features can exist. Three things currently
hold it: a permanent cache keyed to the recording, a configurable daily budget below the hard
limit, and never spending a search without a deliberate user action.

The video-first flow weakens the cache: a song-first search caches on a canonical `artist|title`
from LRCLIB, so every spelling of one recording shares a slot, while a typed query caches on what
the user typed.

**Open decisions, recorded rather than resolved:**

- **No public leaderboard.** Scoring happens in the browser against lyrics the server never sees, so
  the server cannot recompute a run and anyone with devtools can post a plausible number. This sits
  in real tension with a speed-focused audience, who would normally expect ranking. Resolving it
  means moving scoring somewhere verifiable, which the lyrics constraint makes hard. Undecided.
- **Whether public traffic needs rate limiting or abuse handling** beyond the existing daily budget.
  Not yet addressed.

## Brand Commitments

- The name is **TuneType**.
- **No brand assets exist.** No logo, no wordmark file, no favicon, no illustration, no photography,
  no marketing copy. The header is set type. Future work must not imply assets that do not exist.
- **One fixed dark appearance.** Set statically on the document element rather than through a
  color-mode provider; there is no light theme and nothing toggles to one.

## Evidence on Hand

- `README.md` and `PROJECT_CONTEXT.md` are unusually complete, and are written as the project's
  design authority — most decisions carry their reasoning and the alternative that was rejected.
  Read them before contradicting anything.
- 184 passing tests covering the parser, scoring, required-WPM analysis, offset sign convention and
  consensus arithmetic, account arithmetic, video ranking, quota accounting, video-to-lyrics
  matching, and the virtual clock. None require a Firebase project or an API key.
- **Deliberate absences.** Setlists ship empty. There are no users, no usage numbers, no
  testimonials, no press, no case studies, no pricing, and no launch. Future work must not fabricate
  any of these, and must not present the product as having an audience it does not have.
- Test fixtures are synthetic by rule. No file in the repository contains lyrics content.

## Product Principles

1. **Nothing about accounts may become a prerequisite for playing a song.** Signed out, or with no
   Firebase project configured at all, the game plays exactly the same and the account UI hides
   itself.
2. **Lyrics stay in the browser.** They are fetched directly from LRCLIB, live in memory for the
   length of a run, and are never proxied, cached, stored or committed. Anything persisted server
   side is identifiers and counts.
3. **Measurement is honest about what it measures.** WPM is timed per line rather than across the
   run, because a song is mostly not typing. Required WPM is shown next to actual WPM because
   neither number means much alone.
4. **Quota is spent only on a deliberate act.** Opening a screen costs nothing; a search is a button
   someone pressed. Running out degrades to what is already cached rather than to nothing.
5. **Heuristics stay visible and reversible.** Rejected video candidates are shown with their reason
   rather than dropped, rankings are recomputed from cached data rather than frozen, and every
   automatic choice has a manual path beside it.

Principles 1–4 are documented as deliberate decisions in `PROJECT_CONTEXT.md` and were carried
forward from it rather than re-confirmed in interview.

## Accessibility & Inclusion

`prefers-reduced-motion` is honored for the typing caret, character transitions, and the home page
animations.

No product-specific accessibility standard has been established. The game requires a physical
keyboard and audible audio, which excludes some users inherently, and **no accommodation has been
decided either way** — recorded as open rather than as resolved or as out of scope.
