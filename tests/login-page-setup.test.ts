/**
 * Login page: GET /api/auth/setup tells it whether to show the first-time setup
 * link. Also pins that the old passwordless quick sign-in is gone for good.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from '../src/app/api/auth/setup/route';

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, ALLOW_SETUP: env.ALLOW_SETUP };
const restore = () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
};

describe('GET /api/auth/setup (login page setup link)', () => {
  afterEach(restore);

  test('setupAllowed=false in production without ALLOW_SETUP', async () => {
    env.NODE_ENV = 'production';
    delete env.ALLOW_SETUP;
    assert.deepStrictEqual(await GET().json(), { setupAllowed: false });
  });

  test('setupAllowed=true in production with ALLOW_SETUP=true', async () => {
    env.NODE_ENV = 'production';
    env.ALLOW_SETUP = 'true';
    assert.deepStrictEqual(await GET().json(), { setupAllowed: true });
  });

  test('setupAllowed=true outside production', async () => {
    env.NODE_ENV = 'test';
    assert.deepStrictEqual(await GET().json(), { setupAllowed: true });
  });
});

describe('passwordless quick sign-in is removed', () => {
  test('there is no /api/auth/quick-login route', () => {
    assert.strictEqual(existsSync(join(process.cwd(), 'src/app/api/auth/quick-login')), false);
  });
});
