import { app } from '../server/src/app.js';

/**
 * The whole API, as one serverless function.
 *
 * Vercel routes every `/api/*` request here through the rewrite in `vercel.json`, and Express does
 * the rest — the same router tree that runs as a process locally. Exporting the app rather than
 * re-declaring routes means there is one definition of the API, not two that drift.
 *
 * `server/src/index.ts` is deliberately not imported: that file calls listen(), which in a function
 * would bind a port nothing is watching.
 */
export default app;
