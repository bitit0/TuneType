import rateLimit from 'express-rate-limit';
import type { CorsOptions } from 'cors';

/**
 * Who may call this API, and how often.
 *
 * Both limits exist because of one number: the YouTube search budget is roughly a hundred calls a
 * day for everyone using the server combined, and there is no graceful degradation past it. On a
 * machine only the developer could reach that was a budget. Published, it is a resource a stranger
 * can drain in a loop, and an open CORS policy meant any website could spend it from a visitor's
 * browser without that visitor ever seeing this one.
 *
 * Neither of these is airtight. An attacker with a pool of addresses gets a bucket per address,
 * and nothing here changes that — the honest defence against a determined one is an account
 * requirement, which the project rules out for play. What these do is stop a script, a crawler and
 * an accidental render loop, which is the realistic threat to a hobby deployment.
 */

/** Dev hosts are always allowed: Vite serves the client from one of these. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Origins allowed in addition to the dev hosts, comma-separated.
 *
 * Set this to the deployed client's URL. An empty value leaves only localhost, which is the right
 * default for a server nobody has pointed a domain at yet.
 */
function allowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...DEV_ORIGINS, ...configured];
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    /*
     * A missing Origin header is allowed.
     *
     * It means the request did not come from a browser page — curl, a health check, a native
     * client. Refusing those would break monitoring without protecting anything: CORS is a rule
     * browsers enforce on behalf of other origins, and a caller that sets no Origin is not being
     * protected by it in the first place. Nothing here authenticates by cookie, so there is no
     * ambient credential for such a request to ride on.
     */
    if (!origin) return callback(null, true);

    callback(null, allowedOrigins().includes(origin));
  },
};

/**
 * The broad limit. Generous enough that nothing a person does by hand reaches it.
 *
 * Sized against the account and setlist routes, which are cheap. Its job is to catch a runaway
 * client or a crawler, not to ration anything.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a few minutes and try again.' },
});

/**
 * The limit that actually matters, on the two routes that can spend a search.
 *
 * Deliberately not tuned to the daily budget divided by some expected number of users — that
 * number is unknowable and the arithmetic would be theatre. It is set to what one person
 * genuinely searching for songs to play would use in an hour, with room to spare.
 *
 * Cached searches are counted too, even though they cost no quota. Splitting them out would mean
 * the limiter could only decide after the handler had run, and the complexity buys nothing: a
 * cached hit is cheap but not free, and someone making hundreds of them is not playing a song.
 */
export const searchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many searches from this address in the last hour. Try again later.',
  },
});

/**
 * How many reverse proxies sit in front of this server.
 *
 * Behind a host like Render or Fly every request arrives from the proxy, so without this the
 * limiters key every visitor to one bucket and the first busy minute locks out everybody. The
 * value is a hop count rather than `true` on purpose: `true` trusts the whole
 * `X-Forwarded-For` chain, which the client can forge, and each forged address is a fresh bucket.
 */
export function trustProxyHops(): number {
  const parsed = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
