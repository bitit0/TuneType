import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { optionalAuth } from './middleware/auth.js';
import { apiLimiter, corsOptions, trustProxyHops } from './middleware/limits.js';
import { authUnavailableReason, isAuthAvailable } from './firebase.js';
import { isFirestoreAvailable } from './firestore.js';
import { accountRouter } from './routes/account.js';
import { youtubeRouter } from './routes/youtube.js';
import { offsetRouter } from './routes/offsets.js';
import { setlistRouter } from './routes/setlists.js';
import { isYouTubeConfigured } from './youtube/api.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const app = express();
const port = Number(process.env.PORT ?? 8787);

// Behind a proxy the client address is a header, not the socket. See `trustProxyHops`.
app.set('trust proxy', trustProxyHops());

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api', apiLimiter);
app.use(optionalAuth);

/**
 * Note what this server does NOT do: fetch, proxy or store lyrics. The client talks to LRCLIB
 * directly, which is what guarantees no lyrics cache can form here by accident. This process
 * exists to hold the YouTube API key, the account store and, later, the per-video offset store.
 *
 * Accounts obey the same rule. A saved run carries track metadata and counts — never line text,
 * never what the player typed. See `RunSubmission` in shared/src/types.ts.
 */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    authAvailable: isAuthAvailable(),
    // The client reads this to decide whether to offer saving at all, rather than letting a user
    // finish a run and only then discover there was nowhere to put it.
    accountsAvailable: isFirestoreAvailable(),
    // Same dependency as accounts, reported separately because they fail for different reasons in
    // the UI: no accounts means runs aren't saved, no offsets means timing isn't shared.
    offsetsAvailable: isFirestoreAvailable(),
    // Names the actual setup problem instead of leaving a bare `false` to be guessed at.
    accountsUnavailableReason: authUnavailableReason(),
    youtubeConfigured: isYouTubeConfigured(),
    user: req.user ?? null,
  });
});

app.use('/api/account', accountRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/offsets', offsetRouter);
app.use('/api/setlists', setlistRouter);

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
