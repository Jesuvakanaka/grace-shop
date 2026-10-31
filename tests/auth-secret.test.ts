import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { getJwtSecret, createToken, verifyToken, MIN_JWT_SECRET_LENGTH } from '../src/lib/auth';

const STRONG = 'x'.repeat(MIN_JWT_SECRET_LENGTH);
const decode = (key: Uint8Array) => new TextDecoder().decode(key);

describe('JWT secret resolution (ZP-465)', () => {
  const original = { JWT_SECRET: process.env.JWT_SECRET, NODE_ENV: process.env.NODE_ENV };
  const env = process.env as Record<string, string | undefined>;

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  test('production without JWT_SECRET throws (fail closed)', () => {
    assert.throws(() => getJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
  });

  test('production with a short JWT_SECRET throws', () => {
    assert.throws(
      () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'secret-key' }),
      /at least 32/
    );
  });

  test('unset NODE_ENV without JWT_SECRET throws (only development/test may fall back)', () => {
    assert.throws(() => getJwtSecret({}), /JWT_SECRET/);
  });

  test('production with a strong JWT_SECRET uses it', () => {
    assert.strictEqual(decode(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: STRONG })), STRONG);
  });

  test('development and test fall back to a clearly-named dev secret', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const secret = decode(getJwtSecret({ NODE_ENV }));
      assert.match(secret, /insecure-dev-only/);
      assert.notStrictEqual(secret, 'secret-key');
    }
  });

  test('the old hard-coded "secret-key" is never used', () => {
    assert.throws(() => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'secret-key' }));
    assert.notStrictEqual(decode(getJwtSecret({ NODE_ENV: 'development' })), 'secret-key');
  });

  test('secret is resolved lazily at sign time, not at module load', async () => {
    env.NODE_ENV = 'production';
    delete env.JWT_SECRET;
    await assert.rejects(createToken(1, 'owner', 'OWNER'), /JWT_SECRET/);

    env.JWT_SECRET = STRONG;
    const token = await createToken(1, 'owner', 'OWNER');
    const payload = await verifyToken(token);
    assert.strictEqual(payload?.username, 'owner');
    assert.strictEqual(payload?.role, 'OWNER');
  });

  test('a token signed with the dev fallback is rejected by a production secret', async () => {
    env.NODE_ENV = 'development';
    delete env.JWT_SECRET;
    const forged = await createToken(1, 'owner', 'OWNER');

    env.NODE_ENV = 'production';
    env.JWT_SECRET = STRONG;
    assert.strictEqual(await verifyToken(forged), null);
  });
});
