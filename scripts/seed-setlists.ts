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

  // Medium — a conversational pace, sustained.
  { tier: 'medium', id: 19036259, videoId: 'PIFUWHvSixw', artist: 'Journey', title: "Don't Stop Believin'" }, // 52 wpm
  { tier: 'medium', id: 11708782, videoId: '5oWyMakvQew', artist: 'Fleetwood Mac', title: 'Dreams' }, // 60 wpm
  { tier: 'medium', id: 18757410, videoId: 'V1bFr2SWP1I', artist: "Israel Kamakawiwo'ole", title: 'Somewhere Over the Rainbow' }, // 62 wpm

  // Hard — little slack; mistakes start costing lines.
  { tier: 'hard', id: 5388459, videoId: 'aCFLgavufaY', artist: 'Toto', title: 'Africa' }, // 77 wpm
  { tier: 'hard', id: 35925460, videoId: 'j8tZs6G_h7U', artist: 'The Killers', title: 'Mr. Brightside' }, // 79 wpm
  { tier: 'hard', id: 30952201, videoId: 'dLl4PZtxia8', artist: 'Eagles', title: 'Hotel California' }, // 96 wpm

  // Insane — dense, fast, unforgiving.
  { tier: 'insane', id: 4632999, videoId: '-7XnDlYY9qw', artist: 'OutKast', title: 'Hey Ya!' }, // 112 wpm
  { tier: 'insane', id: 32555359, videoId: '3BFTio5296w', artist: 'Rick Astley', title: 'Never Gonna Give You Up' }, // 115 wpm
  { tier: 'insane', id: 18835951, videoId: 'xFYQQPAOz7Y', artist: 'Eminem', title: 'Lose Yourself' }, // 189 wpm

  // Freestyle — kept for their own sake. Long, famous, and not really gradeable.
  { tier: 'freestyle', id: 11432208, videoId: 'QkF3oxziUI4', artist: 'Led Zeppelin', title: 'Stairway to Heaven' }, // 48 wpm, 8:02
  { tier: 'freestyle', id: 18087267, videoId: 'jFKBR1ggTMY', artist: 'Queen', title: 'Bohemian Rhapsody' }, // 64 wpm, 5:57
  { tier: 'freestyle', id: 4145175, videoId: 'bETXDOrmIiM', artist: 'Don McLean', title: 'American Pie' }, // 100 wpm, 8:33
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
