/**
 * UAT quick sign-in (GRACE_QUICK_LOGIN).
 *
 * DB-free tests only: flag parsing, role parsing, and the flag-off behaviour of
 * GET/POST /api/auth/quick-login. The flag-on tests need users in the DB, so they
 * live in tests/business-rules.test.ts (section 8) where they can't race its wipe.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import prisma from '../src/lib/db';
import { isQuickLoginEnabled, parseQuickLoginRole, QUICK_LOGIN_ROLES } from '../src/lib/quick-login';
import { GET, POST } from '../src/app/api/auth/quick-login/route';

const env = process.env as Record<string, string | undefined>;
const saved = { GRACE_QUICK_LOGIN: env.GRACE_QUICK_LOGIN, NODE_ENV: env.NODE_ENV, ALLOW_SETUP: env.ALLOW_SETUP };
const restore = () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
};

/** Replace every prisma.user method with one that records the call and throws. */
function trapUserTable() {
  const calls: string[] = [];
  const user = prisma.user as unknown as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const name of ['findFirst', 'findMany', 'findUnique', 'count']) {
    originals[name] = user[name];
    user[name] = () => {
      calls.push(name);
      throw new Error(`unexpected prisma.user.${name} call`);
    };
  }
  return {
    calls,
    release: () => {
      for (const [name, fn] of Object.entries(originals)) user[name] = fn;
    },
  };
}

describe('isQuickLoginEnabled (flag parsing)', () => {
  test('off when GRACE_QUICK_LOGIN is unset', () => {
    assert.strictEqual(isQuickLoginEnabled({}), false);
  });

  test('off for anything but the exact string "true"', () => {
    for (const GRACE_QUICK_LOGIN of ['', 'false', '1', 'yes', 'TRUE', 'True', ' true', 'true ', 'on']) {
      assert.strictEqual(isQuickLoginEnabled({ GRACE_QUICK_LOGIN }), false, JSON.stringify(GRACE_QUICK_LOGIN));
    }
  });

  test('on only for "true"', () => {
    assert.strictEqual(isQuickLoginEnabled({ GRACE_QUICK_LOGIN: 'true' }), true);
  });

  test('reads process.env by default (off in the test environment)', () => {
    delete env.GRACE_QUICK_LOGIN;
    try {
      assert.strictEqual(isQuickLoginEnabled(), false);
      env.GRACE_QUICK_LOGIN = 'true';
      assert.strictEqual(isQuickLoginEnabled(), true);
    } finally {
      restore();
    }
  });
});

describe('parseQuickLoginRole', () => {
  test('accepts OWNER and STAFF', () => {
    assert.deepStrictEqual([...QUICK_LOGIN_ROLES], ['OWNER', 'STAFF']);
    assert.strictEqual(parseQuickLoginRole({ role: 'OWNER' }), 'OWNER');
    assert.strictEqual(parseQuickLoginRole({ role: 'STAFF' }), 'STAFF');
  });

  test('rejects anything else', () => {
    for (const body of [null, undefined, 'OWNER', {}, { role: 'owner' }, { role: 'ADMIN' }, { role: 1 }, { role: ['OWNER'] }]) {
      assert.strictEqual(parseQuickLoginRole(body), null, JSON.stringify(body));
    }
  });
});

describe('/api/auth/quick-login with the flag off', () => {
  afterEach(restore);

  test('GET returns { enabled: false } without touching the DB', async () => {
    delete env.GRACE_QUICK_LOGIN;
    const trap = trapUserTable();
    try {
      const res = await GET();
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.enabled, false);
      assert.strictEqual('users' in body, false);
      assert.deepStrictEqual(trap.calls, []);
    } finally {
      trap.release();
    }
  });

  test('GET with GRACE_QUICK_LOGIN="false" is also off', async () => {
    env.GRACE_QUICK_LOGIN = 'false';
    const res = await GET();
    assert.strictEqual((await res.json()).enabled, false);
  });

  test('POST returns 404 before parsing the body or touching the DB', async () => {
    delete env.GRACE_QUICK_LOGIN;
    const trap = trapUserTable();
    try {
      // Malformed body: if the handler parsed it first we would get a 400.
      const res = await POST(
        new Request('http://localhost/api/auth/quick-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{not-json',
        })
      );
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.headers.get('set-cookie'), null);
      assert.deepStrictEqual(trap.calls, []);
    } finally {
      trap.release();
    }
  });

  test('POST with a valid role still returns 404 and sets no cookie', async () => {
    delete env.GRACE_QUICK_LOGIN;
    const trap = trapUserTable();
    try {
      const res = await POST(
        new Request('http://localhost/api/auth/quick-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'OWNER' }),
        })
      );
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.headers.get('set-cookie'), null);
      assert.deepStrictEqual(trap.calls, []);
    } finally {
      trap.release();
    }
  });
});

describe('/api/auth/quick-login setupAllowed (login page setup link)', () => {
  afterEach(restore);

  test('GET reports setupAllowed=false in production without ALLOW_SETUP (flag off)', async () => {
    delete env.GRACE_QUICK_LOGIN;
    env.NODE_ENV = 'production';
    delete env.ALLOW_SETUP;
    const body = await (await GET()).json();
    assert.deepStrictEqual(body, { enabled: false, setupAllowed: false });
  });

  test('GET reports setupAllowed=true in production with ALLOW_SETUP=true', async () => {
    delete env.GRACE_QUICK_LOGIN;
    env.NODE_ENV = 'production';
    env.ALLOW_SETUP = 'true';
    assert.strictEqual((await (await GET()).json()).setupAllowed, true);
  });

  test('GET reports setupAllowed=true outside production', async () => {
    delete env.GRACE_QUICK_LOGIN;
    env.NODE_ENV = 'test';
    assert.strictEqual((await (await GET()).json()).setupAllowed, true);
  });

  test('POST with the flag on and a bad role is a 400 before touching the DB', async () => {
    env.GRACE_QUICK_LOGIN = 'true';
    const trap = trapUserTable();
    try {
      for (const body of ['{not-json', JSON.stringify({ role: 'ADMIN' }), JSON.stringify({})]) {
        const res = await POST(
          new Request('http://localhost/api/auth/quick-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        );
        assert.strictEqual(res.status, 400, body);
        assert.strictEqual(res.headers.get('set-cookie'), null);
      }
      assert.deepStrictEqual(trap.calls, []);
    } finally {
      trap.release();
    }
  });
});
