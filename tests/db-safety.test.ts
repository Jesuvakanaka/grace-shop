import { describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import dbSafety from '../scripts/lib/db-safety.js';

const { checkDestructiveDbAllowed, assertDestructiveDbAllowed } = dbSafety;

const LOCAL_URL = 'postgresql://grace:secret@localhost:5433/grace_shop_test';
const REMOTE_URL = 'postgresql://x:y@db.example.com:5432/z';

describe('db-safety: destructive database operations guard', () => {
  test('allows a localhost URL outside production', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: LOCAL_URL, NODE_ENV: 'development' });
    assert.strictEqual(result.allowed, true, result.reason);
  });

  test('allows 127.0.0.1 and [::1] hosts', () => {
    for (const url of [
      'postgresql://u:p@127.0.0.1:5433/db',
      'postgres://u:p@[::1]:5433/db',
    ]) {
      const result = checkDestructiveDbAllowed({ DATABASE_URL: url });
      assert.strictEqual(result.allowed, true, `${url}: ${result.reason}`);
    }
  });

  test('refuses when NODE_ENV=production even for localhost', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: LOCAL_URL, NODE_ENV: 'production' });
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /NODE_ENV=production/);
  });

  test('refuses NODE_ENV=production in any letter case', () => {
    for (const value of ['Production', 'PRODUCTION', ' production ']) {
      const result = checkDestructiveDbAllowed({ DATABASE_URL: LOCAL_URL, NODE_ENV: value });
      assert.strictEqual(result.allowed, false, `NODE_ENV=${JSON.stringify(value)}`);
    }
  });

  test('refuses a non-localhost DATABASE_URL', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: REMOTE_URL });
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /db\.example\.com/);
  });

  test('refuses when DIRECT_URL is remote even if DATABASE_URL is local', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: LOCAL_URL, DIRECT_URL: REMOTE_URL });
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /DIRECT_URL/);
  });

  test('refuses when DATABASE_URL is missing', () => {
    const result = checkDestructiveDbAllowed({});
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /DATABASE_URL is not set/);
  });

  test('refuses an unparseable DATABASE_URL', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: 'not a url' });
    assert.strictEqual(result.allowed, false);
  });

  test('refuses a localhost URL that actually connects through a socket (Cloud SQL ?host=)', () => {
    const result = checkDestructiveDbAllowed({
      DATABASE_URL: 'postgresql://u:p@localhost/db?host=/cloudsql/proj:africa-south1:grace-shop',
    });
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /host=/);
  });

  test('refuses inside a Cloud Run service or job', () => {
    for (const marker of ['K_SERVICE', 'CLOUD_RUN_JOB']) {
      const result = checkDestructiveDbAllowed({ DATABASE_URL: LOCAL_URL, [marker]: 'grace-shop-uat' });
      assert.strictEqual(result.allowed, false, marker);
      assert.match(result.reason, /Cloud Run/);
    }
  });

  test('refuses hostnames that merely start with localhost', () => {
    const result = checkDestructiveDbAllowed({ DATABASE_URL: 'postgresql://u:p@localhost.evil.com:5432/db' });
    assert.strictEqual(result.allowed, false);
  });

  test('assertDestructiveDbAllowed throws with the reason and names the operation', () => {
    assert.throws(
      () => assertDestructiveDbAllowed('database reset', { DATABASE_URL: REMOTE_URL }),
      /Refusing to run database reset[\s\S]*db\.example\.com/,
    );
    assert.doesNotThrow(() => assertDestructiveDbAllowed('database reset', { DATABASE_URL: LOCAL_URL }));
  });

  test('CLI exits non-zero and prints the reason for a remote URL', () => {
    const script = path.join(__dirname, '..', 'scripts', 'lib', 'db-safety.js');
    const run = spawnSync(process.execPath, [script, 'test op'], {
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: REMOTE_URL, DB_SAFETY_SKIP_DOTENV: '1' } as unknown as NodeJS.ProcessEnv, // Next's types make NODE_ENV required; the child must not inherit it
      encoding: 'utf8',
    });
    assert.notStrictEqual(run.status, 0);
    assert.match(run.stderr, /Refusing to run test op/);
  });

  test('CLI exits zero for a localhost URL', () => {
    const script = path.join(__dirname, '..', 'scripts', 'lib', 'db-safety.js');
    const run = spawnSync(process.execPath, [script, 'test op'], {
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: LOCAL_URL, DB_SAFETY_SKIP_DOTENV: '1' } as unknown as NodeJS.ProcessEnv, // Next's types make NODE_ENV required; the child must not inherit it
      encoding: 'utf8',
    });
    assert.strictEqual(run.status, 0, run.stderr);
  });
});
