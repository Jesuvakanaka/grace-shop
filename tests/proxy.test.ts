/**
 * ZP-485 review D3: the real proxy function (not just the pure decision) on
 * the storefront host.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

const env = process.env as Record<string, string | undefined>;
const saved = {
  GRACE_STOREFRONT_HOSTS: env.GRACE_STOREFRONT_HOSTS,
  GRACE_ADMIN_HOSTS: env.GRACE_ADMIN_HOSTS,
  GRACE_QUICK_LOGIN: env.GRACE_QUICK_LOGIN,
};

describe('proxy (src/proxy.ts)', () => {
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  test('storefront host: POST /api/auth/quick-login is 404 even with GRACE_QUICK_LOGIN=true', async () => {
    env.GRACE_STOREFRONT_HOSTS = 'shop.localhost';
    env.GRACE_QUICK_LOGIN = 'true';
    const res = proxy(new NextRequest('http://shop.localhost/api/auth/quick-login', { method: 'POST' }));
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('x-middleware-rewrite'), null);
    assert.strictEqual(res.headers.get('x-middleware-next'), null);
    assert.strictEqual(await res.text(), 'Not Found');
  });

  test('storefront host: / is rewritten to /site', () => {
    env.GRACE_STOREFRONT_HOSTS = 'shop.localhost';
    const res = proxy(new NextRequest('http://shop.localhost/'));
    const rewrite = res.headers.get('x-middleware-rewrite');
    assert.ok(rewrite, 'expected a rewrite');
    assert.strictEqual(new URL(rewrite).pathname, '/site');
    assert.strictEqual(res.headers.get('x-robots-tag'), null);
  });

  test('storefront host: /site/x is a 308 to /x, query kept', () => {
    env.GRACE_STOREFRONT_HOSTS = 'shop.localhost';
    const res = proxy(new NextRequest('http://shop.localhost/site/x?a=1'));
    assert.strictEqual(res.status, 308);
    const loc = new URL(res.headers.get('location') ?? '');
    assert.strictEqual(loc.pathname + loc.search, '/x?a=1');
  });

  test('no env: passes through with X-Robots-Tag noindex', () => {
    delete env.GRACE_STOREFRONT_HOSTS;
    delete env.GRACE_ADMIN_HOSTS;
    const res = proxy(new NextRequest('http://shop.localhost/api/auth/quick-login', { method: 'POST' }));
    assert.strictEqual(res.headers.get('x-middleware-next'), '1');
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});
