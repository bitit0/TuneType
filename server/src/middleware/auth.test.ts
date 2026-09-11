import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from './auth.js';

/**
 * Who counts as a curator.
 *
 * This is the only access control in the project, so it gets tested as one. The case that matters
 * is not "does the happy path work" — it is that an address nobody has proven they own must never
 * be enough.
 */

const user = (over: Partial<NonNullable<Parameters<typeof isAdmin>[0]>> = {}) => ({
  uid: 'uid-normal',
  email: 'someone@example.com',
  name: null,
  emailVerified: true,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe('isAdmin', () => {
  it('grants nobody when nothing is configured', () => {
    // The default posture. A fresh clone has no admins, not an open door.
    expect(isAdmin(user())).toBe(false);
    expect(isAdmin(user({ email: 'admin@example.com' }))).toBe(false);
  });

  it('grants a listed, verified email', () => {
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
    expect(isAdmin(user({ email: 'admin@example.com' }))).toBe(true);
  });

  it('refuses a listed email the provider has not verified', () => {
    /*
     * The attack this exists to stop: Firebase email/password sign-up lets anyone register an
     * account claiming any address. Without the verified check, ADMIN_EMAILS would mean "whoever
     * types this address into the sign-up form first".
     */
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
    expect(isAdmin(user({ email: 'admin@example.com', emailVerified: false }))).toBe(false);
  });

  it('ignores case and padding in both the list and the token', () => {
    vi.stubEnv('ADMIN_EMAILS', ' Admin@Example.com , other@example.com ');
    expect(isAdmin(user({ email: 'ADMIN@example.COM' }))).toBe(true);
    expect(isAdmin(user({ email: 'other@example.com' }))).toBe(true);
  });

  it('grants a listed uid without involving the address at all', () => {
    // The escape hatch for anyone who would rather not tie admin rights to an email address —
    // and the only route that works for a provider that supplies no verified address.
    vi.stubEnv('ADMIN_UIDS', 'uid-curator');
    expect(isAdmin(user({ uid: 'uid-curator', email: null, emailVerified: false }))).toBe(true);
  });

  it('refuses a guest', () => {
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
    expect(isAdmin(undefined)).toBe(false);
  });

  it('does not treat an empty setting as a wildcard', () => {
    // An empty env var splits to [''], and a user with no email must not match that.
    vi.stubEnv('ADMIN_EMAILS', '');
    vi.stubEnv('ADMIN_UIDS', ',, ,');
    expect(isAdmin(user({ email: '' }))).toBe(false);
    expect(isAdmin(user({ email: null }))).toBe(false);
  });
});
