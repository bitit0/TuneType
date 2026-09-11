# TuneType

A browser typing game. A YouTube video plays, synced lyrics scroll in time with the song, and you
type each line as it's sung.

The interesting part is the timing layer, not the game.

```bash
npm install
npm run dev
```

Client on http://localhost:5173, API on http://localhost:8787. **No cloud setup is needed to play** —
copy `.env.example` to `.env` only when you want sign-in, video search or setlists.

## How a run works

1. **Search for the video.** Results come from YouTube, filtered to what can be embedded.
2. **Pick one, and the lyrics follow.** Its title and length are matched against LRCLIB — title
   decides which song, length decides which cut.
3. **Play.** Press play and start typing. Nudge the lyrics with <kbd>←</kbd> / <kbd>→</kbd> if they
   drift.

The song-first flow at `/songs` is the fallback when nothing matches, and the only flow on a server
with no `YOUTUBE_API_KEY`.

## The timing layer

The player runs in a cross-origin iframe, so there are no audio samples and the only clock is
`getCurrentTime()`, which advances in steps of roughly 250ms. Reading it directly makes the lyrics
stutter — the reported position is never ahead of true playback and sweeps from zero to a full step
behind, over and over.

`client/src/lib/timing/VirtualClock.ts` runs its own clock and uses the player only to correct it.
It re-anchors on the *instants the polled value changes* rather than on every poll, since a
transition pins true time to within one poll interval while a repeated reading carries nothing. When
a fresh anchor disagrees, it bends the clock's **rate** by up to 2% instead of jumping, so
corrections stay invisible. Only a disagreement too large to be drift earns a hard resync.

![Clock error against true playback time](docs/drift.svg)

Thirty seconds of playback against a 250ms-quantized player. Reading `getCurrentTime()` directly
peaks **200ms** behind; the virtual clock holds **13ms**. Regenerate with `npm run chart:drift`.

That is a simulation with perfectly regular polling. Against a real video the debug overlay on the
play screen is the instrument — it shows virtual time, polled time, drift and rate while you play.

## Things worth knowing before changing something

**Lyrics never touch the server.** The client fetches them straight from LRCLIB, they live in memory
for one run, and nothing persists them. `toRunSubmission` and `toSetlistSubmission` are the two
enforcement points — read one before adding a field. Saved runs are track metadata and counts.

**Per-key stats are a lifetime tally, never per track.** Summed across every song it describes how
you type; kept per track it would be a letter-frequency profile of that track's words.

**Search quota is the binding constraint.** `search.list` costs 100 of 10,000 daily units — about a
hundred searches a day for everyone using the server combined. Three things hold it: a permanent
cache keyed to the recording, a daily budget persisted to Firestore, and never spending a search
without a deliberate user action.

**Scoring is verifiable only for curated songs.** Setlist entries store each line's length and
window — numbers, not words — so the server can price a run itself. That is what makes their
leaderboards comparable. It is not anti-cheat, and `server/src/setlists/score.ts` says so.

**Admin comes from the environment**, not a database flag, and `ADMIN_EMAILS` matches only
provider-verified addresses.

`PROJECT_CONTEXT.md` has the full design rationale, and most decisions carry their reasoning in a
comment beside the code.

## Setlists

Curated songs in difficulty tiers — Easy, Medium, Hard, Insane, then Freestyle for songs kept for
their own sake rather than for where they rank. Tiers share their names with the automatic pace
bands, and the two disagreeing is informative: required WPM measures how fast words arrive, not how
hard they are to type.

Forty are seeded. `npm run seed:setlists` re-applies them, and it is idempotent.

## Tests

```bash
npm test          # 215 unit tests
npm run test:e2e  # Playwright, stubs every external service
```

Covers the parser, scoring, required-WPM analysis, the offset sign convention and consensus, account
arithmetic, video ranking and quota accounting, video-to-lyrics matching, and the virtual clock
against a fake player. Nothing needs a Firebase project or an API key. Test fixtures are synthetic —
no file in this repository contains lyrics.

What tests cannot cover is whether the sync *feels* right. That is a manual check against a real
song.
