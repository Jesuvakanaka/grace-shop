import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { isSetupAllowed } from '../src/lib/setup-guard';
import { POST as setupPOST } from '../src/app/api/auth/setup/route';

describe('First-time setup guard (ZP-465)', () => {
  const env = process.env as Record<string, string | undefined>;
  const original = { NODE_ENV: env.NODE_ENV, ALLOW_SETUP: env.ALLOW_SETUP };

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  test('disabled in production by default', () => {
    assert.strictEqual(isSetupAllowed({ NODE_ENV: 'production' }), false);
  });

  test('disabled in production when ALLOW_SETUP is anything but "true"', () => {
    for (const ALLOW_SETUP of ['', 'false', '1', 'yes', 'TRUE ']) {
      assert.strictEqual(isSetupAllowed({ NODE_ENV: 'production', ALLOW_SETUP }), false, ALLOW_SETUP);
    }
  });

  test('enabled in production only with ALLOW_SETUP=true', () => {
    assert.strictEqual(isSetupAllowed({ NODE_ENV: 'production', ALLOW_SETUP: 'true' }), true);
  });

  test('enabled outside production (local dev / e2e)', () => {
    assert.strictEqual(isSetupAllowed({ NODE_ENV: 'development' }), true);
    assert.strictEqual(isSetupAllowed({ NODE_ENV: 'test' }), true);
  });

  test('POST /api/auth/setup returns 403 in production without ALLOW_SETUP, before touching the DB', async () => {
    env.NODE_ENV = 'production';
    delete env.ALLOW_SETUP;
    const res = await setupPOST(
      new Request('http://localhost/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'attacker', password: 'attacker-password', fullName: 'Attacker' }),
      })
    );
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /disabled/i);
  });
});
