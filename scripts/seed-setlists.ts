import dotenv from 'dotenv';
dotenv.config();

import { fetchTrackById } from '../client/src/lib/lrclib/client.js';
import { analyzeDifficulty } from '../client/src/lib/scoring/difficulty.js';
import type { LineSpec, PlayableTrack, SetlistSubmission, SetlistTier } from '../shared/src/types.js';

/**
 * Seeds the curated setlists.
 *
 * Run with `npm run seed:setlists`. Idempotent — `addEntry` keys on the LRCLIB id, so re-running
 * updates the existing entries rather than duplicating them.
 *
 * This exists because the setlists live in Firestore and nothing else in the repository records
 * them. The picks below took real work to choose: each song was measured against live LRCLIB for
 * its required pace, then given a video the ranking rated well with a duration close to the
 * track's. Losing that to a database reset would mean doing it again from memory.
 *
 * Tiers are a curator's call, with the measured pace beside each as the check. The bands in
 * `scoring/constants.ts` are easy <=45, medium <=70, hard <=100, insane above. Freestyle is off the
 * ladder entirely — these three are long and famous rather than graded, which is what that tier is
 * for.
 *
 * Display metadata is written here rather than taken from LRCLIB, whose track names are frequently
 * messy: "Radiohead - Creep" as a title, the artist repeated inside it. The lrclibId still decides
 * which lyrics load.
 */
const PICKS: Array<{ tier: SetlistTier; id: number; videoId: string; artist: string; title: string }> = [
  // Easy — room to think between lines.
  { tier: 'easy', id: 16142327, videoId: 'qsB2S4cuVOA', artist: 'Elvis Presley', title: "Can't Help Falling in Love" }, // 36 wpm
  { tier: 'easy', id: 9327996, videoId: 'XFkzRNyygfk', artist: 'Radiohead', title: 'Creep' }, // 43 wpm
  { tier: 'easy', id: 18242447, videoId: 'VOgFZfRVaww', artist: 'John Lennon', title: 'Imagine' }, // 44 wpm

  { tier: 'easy', id: 36267688, videoId: 'tP0zj220CbQ', artist: 'Whitney Houston', title: 'I Will Always Love You' }, // 32 wpm
  { tier: 'easy', id: 28973516, videoId: 'ZqtyQuXo9zM', artist: 'Eric Clapton', title: 'Tears in Heaven' }, // 34 wpm
  { tier: 'easy', id: 35456158, videoId: 'Zv8czIoAw5w', artist: 'The Righteous Brothers', title: 'Unchained Melody' }, // 34 wpm
  { tier: 'easy', id: 28973295, videoId: 'uGXHVGhqMcs', artist: 'Nat King Cole & Natalie Cole', title: 'Unforgettable' }, // 36 wpm
  { tier: 'easy', id: 31361367, videoId: 'YtZ-IgUjALo', artist: 'Etta James', title: 'At Last' }, // 37 wpm

  // Medium — a conversational pace, sustained.
  { tier: 'medium', id: 19036259, videoId: 'PIFUWHvSixw', artist: 'Journey', title: "Don't Stop Believin'" }, // 52 wpm
  { tier: 'medium', id: 11708782, videoId: '5oWyMakvQew', artist: 'Fleetwood Mac', title: 'Dreams' }, // 60 wpm
  { tier: 'medium', id: 18757410, videoId: 'V1bFr2SWP1I', artist: "Israel Kamakawiwo'ole", title: 'Somewhere Over the Rainbow' }, // 62 wpm

  { tier: 'medium', id: 34837346, videoId: 'RB-RcX5DS5A', artist: 'Coldplay', title: 'The Scientist' }, // 51 wpm
  { tier: 'medium', id: 28857667, videoId: 'fOZ-MySzAac', artist: 'Bill Withers', title: 'Lean on Me' }, // 58 wpm
  { tier: 'medium', id: 36923194, videoId: '7TDeBi34OtE', artist: 'Nirvana', title: 'Smells Like Teen Spirit' }, // 60 wpm
  { tier: 'medium', id: 749961, videoId: 'AJDiYxKSAqQ', artist: 'Green Day', title: 'Basket Case' }, // 66 wpm
  { tier: 'medium', id: 33644816, videoId: 'YkLLcIKhJ64', artist: 'ABBA', title: 'Dancing Queen' }, // 69 wpm

  // Hard — little slack; mistakes start costing lines.
  { tier: 'hard', id: 5388459, videoId: 'aCFLgavufaY', artist: 'Toto', title: 'Africa' }, // 77 wpm
  { tier: 'hard', id: 35925460, videoId: 'j8tZs6G_h7U', artist: 'The Killers', title: 'Mr. Brightside' }, // 79 wpm
  { tier: 'hard', id: 30952201, videoId: 'dLl4PZtxia8', artist: 'Eagles', title: 'Hotel California' }, // 96 wpm

  { tier: 'hard', id: 36523298, videoId: 'BwX8OS4cegU', artist: 'The Weeknd', title: 'Blinding Lights' }, // 71 wpm
  { tier: 'hard', id: 29090003, videoId: 'YBdyc1WDlBQ', artist: 'Bon Jovi', title: "Livin' on a Prayer" }, // 79 wpm
  { tier: 'hard', id: 33610148, videoId: 'hLQl3WQQoQ0', artist: 'Adele', title: 'Someone Like You' }, // 81 wpm
  { tier: 'hard', id: 24218749, videoId: 'lLCdSS-S_cI', artist: 'Survivor', title: 'Eye of the Tiger' }, // 81 wpm
  { tier: 'hard', id: 24461692, videoId: '8kvkitq3MAU', artist: 'Otis Redding', title: "(Sittin' On) The Dock of the Bay" }, // 83 wpm

  // Insane — dense, fast, unforgiving.
  { tier: 'insane', id: 4632999, videoId: '-7XnDlYY9qw', artist: 'OutKast', title: 'Hey Ya!' }, // 112 wpm
  { tier: 'insane', id: 32555359, videoId: '3BFTio5296w', artist: 'Rick Astley', title: 'Never Gonna Give You Up' }, // 115 wpm
  { tier: 'insane', id: 18835951, videoId: 'xFYQQPAOz7Y', artist: 'Eminem', title: 'Lose Yourself' }, // 189 wpm

  { tier: 'insane', id: 38090396, videoId: 'MHi9mKq0slA', artist: 'Queen', title: "Don't Stop Me Now" }, // 102 wpm
  { tier: 'insane', id: 6585721, videoId: 'Kr4EQDVETuA', artist: 'Michael Jackson', title: 'Billie Jean' }, // 103 wpm
  { tier: 'insane', id: 36047362, videoId: 'AIOAlaACuv4', artist: 'Tracy Chapman', title: 'Fast Car' }, // 111 wpm
  { tier: 'insane', id: 37617858, videoId: '7_zZQazMqrE', artist: 'Panic! At The Disco', title: 'I Write Sins Not Tragedies' }, // 116 wpm
  { tier: 'insane', id: 25132079, videoId: '8OyBtMPqpNY', artist: 'R.E.M.', title: "It's the End of the World as We Know It" }, // 124 wpm

  // Freestyle — kept for their own sake. Long, famous, and not really gradeable.
  { tier: 'freestyle', id: 11432208, videoId: 'QkF3oxziUI4', artist: 'Led Zeppelin', title: 'Stairway to Heaven' }, // 48 wpm, 8:02
  { tier: 'freestyle', id: 18087267, videoId: 'jFKBR1ggTMY', artist: 'Queen', title: 'Bohemian Rhapsody' }, // 64 wpm, 5:57
  { tier: 'freestyle', id: 4145175, videoId: 'bETXDOrmIiM', artist: 'Don McLean', title: 'American Pie' }, // 100 wpm, 8:33
  { tier: 'freestyle', id: 26319696, videoId: '_g_tuOS-iZ4', artist: 'The Doors', title: 'Light My Fire' }, // 27 wpm, 7:06
  { tier: 'freestyle', id: 21719052, videoId: 'K6qj09OHvjw', artist: 'Pink Floyd', title: 'Wish You Were Here' }, // 36 wpm, 5:40
  { tier: 'freestyle', id: 34919919, videoId: 'VGfDg7wju6M', artist: 'Oasis', title: 'Champagne Supernova' }, // 58 wpm, 7:29
  { tier: 'freestyle', id: 10422487, videoId: 'RhfHed14cNc', artist: 'The Beatles', title: 'Hey Jude' }, // 70 wpm, 7:10
  { tier: 'freestyle', id: 36260258, videoId: 'acJ-Wt3rpfc', artist: 'Billy Joel', title: 'Piano Man' }, // 75 wpm, 5:35
];

/** The API this seeds through. Start the server first. */
const API = process.env.SEED_API ?? 'http://localhost:8787';

/*
 * Mirrors `toSetlistSubmission` in the client.
 *
 * Not imported from it, because that module also pulls in the API client and through it the
 * Firebase config, which reads `import.meta.env` and does not exist outside Vite. The payload still
 * goes through the server's own schema, which is where the real check lives.
 */
function buildSubmission(track: PlayableTrack, videoId: string, tier: SetlistTier): SetlistSubmission {
  const difficulty = analyzeDifficulty(track.lines);

  return {
    tier,
    lrclibId: track.lrclibId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    videoId,
    durationSec: track.durationSec,
    requiredWpm: Number(difficulty.requiredWpm.toFixed(2)),
    peakWpm: Number(difficulty.peakWpm.toFixed(2)),
    lineCount: difficulty.lineCount,
    scoreProfile: track.lines.map(
      (line): LineSpec => ({
        len: line.text.length,
        startMs: Math.round(line.startMs),
        endMs: Math.round(line.endMs),
      }),
    ),
  };
}

// --- Sign in as the configured admin ---------------------------------------------------------

const adminEmail = (process.env.ADMIN_EMAILS ?? '').split(',')[0]!.trim();
if (!adminEmail) throw new Error('ADMIN_EMAILS is empty; nobody may curate.');

const admin = (await import('firebase-admin')).default;
const { getFirebaseAdmin } = await import('../server/src/firebase.js');
if (!getFirebaseAdmin()) throw new Error('Firebase Admin is not configured.');

const user = await admin.auth().getUserByEmail(adminEmail);
if (!user.emailVerified) throw new Error(`${adminEmail} is not provider-verified, so isAdmin() will refuse it.`);

const customToken = await admin.auth().createCustomToken(user.uid);
const webKey = process.env.VITE_FIREBASE_API_KEY;

const exchange = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
);
const { idToken, error } = (await exchange.json()) as { idToken?: string; error?: { message: string } };
if (!idToken) throw new Error(`Could not mint an ID token: ${error?.message}`);

console.log(`Curating as ${adminEmail}\n`);

// --- Curate ----------------------------------------------------------------------------------

for (const pick of PICKS) {
  const track = await fetchTrackById(pick.id);
  if (!track) { console.log(`  SKIP ${pick.title}: gone from LRCLIB`); continue; }

  const submission = buildSubmission({ ...track, artist: pick.artist, title: pick.title }, pick.videoId, pick.tier);

  const res = await fetch(`${API}/api/setlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(submission),
  });

  const body = (await res.json()) as { error?: string; id?: string };
  console.log(
    res.ok
      ? `  ${pick.tier.padEnd(9)} ${String(Math.round(submission.requiredWpm)).padStart(3)}w  ${String(submission.lineCount).padStart(3)}L  ${pick.artist} — ${pick.title}`
      : `  FAILED ${res.status} ${pick.title}: ${body.error}`,
  );
}
