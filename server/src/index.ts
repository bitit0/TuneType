import { app } from './app.js';

/**
 * The long-running server, for local development and for any host that runs a process.
 *
 * Serverless deployments import `app` directly and never reach this file — calling listen() there
 * would bind a port nothing is watching and hold the invocation open.
 */
const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
