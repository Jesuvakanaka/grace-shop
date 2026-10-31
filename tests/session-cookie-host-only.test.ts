/**
 * ZP-485: the `auth-token` session cookie must be host-only (no Domain
 * attribute), so a sign-in on the admin host is never sent to the storefront
 * host, even when both are subdomains of one registrable domain.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_COOKIE_NAME, signedInResponse } from '../src/lib/session-cookie';
import { POST as logout } from '../src/app/api/auth/logout/route';

function authCookieHeader(res: Response): string {
  const all = res.headers.getSetCookie();
  const cookie = all.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
  assert.ok(cookie, `expected a Set-Cookie for ${AUTH_COOKIE_NAME}, got ${JSON.stringify(all)}`);
  return cookie;
}

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, JWT_SECRET: env.JWT_SECRET };
const TEST_SECRET = 'zp485-host-only-cookie-tests-secret-0123456789';
const user = { id: 1, username: 'owner', fullName: 'Owner', role: 'OWNER' };

describe('auth-token cookie is host-only', () => {
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  test('sign-in cookie (login + quick-login) has no Domain attribute', async () => {
    env.JWT_SECRET = TEST_SECRET;
    const cookie = authCookieHeader(await signedInResponse(user));
    assert.doesNotMatch(cookie, /;\s*domain=/i, cookie);
    assert.match(cookie, /;\s*path=\//i);
    assert.match(cookie, /;\s*httponly/i);
  });

  test('production sign-in cookie is Secure and still has no Domain attribute', async () => {
    env.NODE_ENV = 'production';
    env.JWT_SECRET = TEST_SECRET;
    const cookie = authCookieHeader(await signedInResponse(user));
    assert.doesNotMatch(cookie, /;\s*domain=/i, cookie);
    assert.match(cookie, /;\s*secure/i);
  });

  test('logout cookie has no Domain attribute (a Domain would not clear a host-only cookie)', async () => {
    const res = await logout();
    const cookie = authCookieHeader(res);
    assert.doesNotMatch(cookie, /;\s*domain=/i, cookie);
  });

  test('no auth route sets a cookie domain', () => {
    // The setup route needs the DB to reach its cookie, so guard its source instead.
    const authDir = path.join(__dirname, '..', 'src', 'app', 'api', 'auth');
    const files = [path.join(__dirname, '..', 'src', 'lib', 'session-cookie.ts')];
    for (const entry of fs.readdirSync(authDir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path.join(entry.parentPath, entry.name));
    }
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(src, /\bdomain\s*:/i, `${file} sets a cookie domain`);
    }
  });
});
