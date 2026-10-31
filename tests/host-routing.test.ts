/**
 * ZP-485: host-based routing ("two front doors").
 *
 * Pure decision tests for src/lib/host-routing.ts, plus a filesystem guard that
 * the storefront's admin block-list covers every admin page section.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_PAGE_SECTIONS,
  classifyHost,
  decideHostRouting,
  normalizeHost,
  parseHostList,
  type HostRoutingConfig,
} from '../src/lib/host-routing';

const CONFIGURED: HostRoutingConfig = {
  storefrontHosts: ['shop.localhost', 'vyra.example'],
  adminHosts: ['admin.localhost'],
};
const NO_ENV: HostRoutingConfig = { storefrontHosts: [], adminHosts: [] };

const MATRIX_PATHS = [
  '/',
  '/shop',
  '/p/x',
  '/brand/vyra-mark.svg',
  '/_next/static/chunks/app.js',
  '/api/public/x',
  '/api/auth/login',
  '/api/auth/quick-login',
  '/api/products',
  '/products',
  '/settings/password',
  '/site/x',
];

describe('normalizeHost', () => {
  test('lowercases and strips the port', () => {
    assert.strictEqual(normalizeHost('Shop.LocalHost:3485'), 'shop.localhost');
    assert.strictEqual(normalizeHost('VYRA.example'), 'vyra.example');
  });

  test('trims whitespace and a trailing dot', () => {
    assert.strictEqual(normalizeHost('  vyra.example.  '), 'vyra.example');
  });

  test('handles bracketed IPv6 with and without a port', () => {
    assert.strictEqual(normalizeHost('[::1]:3485'), '[::1]');
    assert.strictEqual(normalizeHost('[::1]'), '[::1]');
  });

  test('missing or empty Host header gives null', () => {
    assert.strictEqual(normalizeHost(null), null);
    assert.strictEqual(normalizeHost(undefined), null);
    assert.strictEqual(normalizeHost(''), null);
    assert.strictEqual(normalizeHost('   '), null);
  });
});

describe('parseHostList', () => {
  test('comma-separated, lowercased, ports dropped, blanks ignored', () => {
    assert.deepStrictEqual(parseHostList(' Shop.localhost:3485, ,vyra.example,'), [
      'shop.localhost',
      'vyra.example',
    ]);
  });

  test('unset or empty gives an empty list', () => {
    assert.deepStrictEqual(parseHostList(undefined), []);
    assert.deepStrictEqual(parseHostList(''), []);
    assert.deepStrictEqual(parseHostList(' , '), []);
  });
});

describe('classifyHost', () => {
  test('storefront host, regardless of case and port', () => {
    assert.strictEqual(classifyHost('shop.localhost', CONFIGURED), 'storefront');
    assert.strictEqual(classifyHost('SHOP.localhost:3485', CONFIGURED), 'storefront');
  });

  test('www. prefix matches the bare listed host', () => {
    assert.strictEqual(classifyHost('www.vyra.example', CONFIGURED), 'storefront');
    assert.strictEqual(classifyHost('WWW.vyra.example:443', CONFIGURED), 'storefront');
  });

  test('www. is only stripped as a prefix, not matched loosely', () => {
    assert.strictEqual(classifyHost('evilvyra.example', CONFIGURED), 'admin');
    assert.strictEqual(classifyHost('vyra.example.evil.test', CONFIGURED), 'admin');
    assert.strictEqual(classifyHost('x.vyra.example', CONFIGURED), 'admin');
  });

  test('admin host is admin', () => {
    assert.strictEqual(classifyHost('admin.localhost:3485', CONFIGURED), 'admin');
  });

  test('unknown host falls back to admin (run.app URL, tag URLs, probes keep working)', () => {
    assert.strictEqual(classifyHost('grace-shop-uat-abc.a.run.app', CONFIGURED), 'admin');
    assert.strictEqual(classifyHost('localhost:3485', CONFIGURED), 'admin');
  });

  test('missing Host header is admin', () => {
    assert.strictEqual(classifyHost(null, CONFIGURED), 'admin');
    assert.strictEqual(classifyHost(undefined, CONFIGURED), 'admin');
  });

  test('no env: every host is admin, even one that looks like a shop', () => {
    assert.strictEqual(classifyHost('shop.localhost', NO_ENV), 'admin');
    assert.strictEqual(classifyHost(null, NO_ENV), 'admin');
  });

  test('a host listed as both storefront and admin is storefront (least exposure)', () => {
    const both: HostRoutingConfig = { storefrontHosts: ['x.test'], adminHosts: ['x.test'] };
    assert.strictEqual(classifyHost('x.test', both), 'storefront');
  });
});

describe('decideHostRouting: storefront host', () => {
  const sf = (pathname: string) => decideHostRouting({ host: 'shop.localhost:3485', pathname }, CONFIGURED);

  test('matrix', () => {
    const expected: Record<string, unknown> = {
      '/': { action: 'rewrite', pathname: '/site' },
      '/shop': { action: 'rewrite', pathname: '/site/shop' },
      '/p/x': { action: 'rewrite', pathname: '/site/p/x' },
      '/brand/vyra-mark.svg': { action: 'next', noindex: false },
      '/_next/static/chunks/app.js': { action: 'next', noindex: false },
      '/api/public/x': { action: 'next', noindex: false },
      '/api/auth/login': { action: 'not-found' },
      '/api/auth/quick-login': { action: 'not-found' },
      '/api/products': { action: 'not-found' },
      '/products': { action: 'not-found' },
      '/settings/password': { action: 'not-found' },
      '/site/x': { action: 'redirect', pathname: '/x' },
    };
    for (const p of MATRIX_PATHS) {
      assert.deepStrictEqual(sf(p), expected[p], p);
    }
  });

  test('/site and /site/ redirect to /', () => {
    assert.deepStrictEqual(sf('/site'), { action: 'redirect', pathname: '/' });
    assert.deepStrictEqual(sf('/site/'), { action: 'redirect', pathname: '/' });
    assert.deepStrictEqual(sf('/site/p/x/'), { action: 'redirect', pathname: '/p/x/' });
  });

  test('/sitemap.xml and /siteinfo are not mistaken for the /site prefix', () => {
    assert.deepStrictEqual(sf('/sitemap.xml'), { action: 'next', noindex: false });
    assert.deepStrictEqual(sf('/siteinfo'), { action: 'rewrite', pathname: '/site/siteinfo' });
  });

  test('public files pass through', () => {
    for (const p of [
      '/favicon.ico',
      '/icon.svg',
      '/apple-icon.png',
      '/manifest.webmanifest',
      '/robots.txt',
      '/sitemap.xml',
      '/brand/vyra-lockup.svg',
      '/brand/vyra-icon-192.png',
      '/_next/image',
      '/api/images/public/abc.webp',
    ]) {
      assert.deepStrictEqual(sf(p), { action: 'next', noindex: false }, p);
    }
  });

  test('every other /api path is 404, including near-misses of the public prefixes', () => {
    for (const p of [
      '/api',
      '/api/',
      '/api/auth/session',
      '/api/auth/logout',
      '/api/auth/setup',
      '/api/health',
      '/api/dashboard',
      '/api/images/abc.webp',
      '/api/publicity',
      '/api/images/publicx/1',
      '/API/products',
    ]) {
      assert.deepStrictEqual(sf(p), { action: 'not-found' }, p);
    }
  });

  test('every admin page section (and its children) is 404', () => {
    for (const section of ADMIN_PAGE_SECTIONS) {
      assert.deepStrictEqual(sf(`/${section}`), { action: 'not-found' }, section);
      assert.deepStrictEqual(sf(`/${section}/`), { action: 'not-found' }, `${section}/`);
      assert.deepStrictEqual(sf(`/${section}/anything/deep`), { action: 'not-found' }, `${section}/…`);
    }
  });

  test('admin sections are matched case-insensitively', () => {
    assert.deepStrictEqual(sf('/Products'), { action: 'not-found' });
    assert.deepStrictEqual(sf('/SETTINGS/password'), { action: 'not-found' });
  });

  test('a file-like path below an admin section is still 404, not a static pass', () => {
    assert.deepStrictEqual(sf('/products/x.png'), { action: 'not-found' });
  });

  test('www. storefront host routes the same', () => {
    assert.deepStrictEqual(
      decideHostRouting({ host: 'www.vyra.example', pathname: '/' }, CONFIGURED),
      { action: 'rewrite', pathname: '/site' }
    );
  });
});

describe('decideHostRouting: admin host and no env are unchanged', () => {
  const cases: Array<[string, HostRoutingConfig, string | null]> = [
    ['admin host', CONFIGURED, 'admin.localhost:3485'],
    ['unknown host with env set', CONFIGURED, 'grace-shop-uat-abc.a.run.app'],
    ['missing Host with env set', CONFIGURED, null],
    ['no env, shop-looking host', NO_ENV, 'shop.localhost:3485'],
    ['no env, localhost', NO_ENV, 'localhost:3485'],
    ['no env, missing Host', NO_ENV, null],
  ];

  for (const [label, config, host] of cases) {
    test(`${label}: every path passes through with noindex`, () => {
      for (const p of [...MATRIX_PATHS, '/site', '/site/', '/api/auth/session', '/api/health']) {
        assert.deepStrictEqual(decideHostRouting({ host, pathname: p }, config), { action: 'next', noindex: true }, p);
      }
    });
  }
});

describe('ADMIN_PAGE_SECTIONS stays in sync with the admin pages', () => {
  test('every top-level admin page directory is in the block-list', () => {
    const adminDir = path.join(__dirname, '..', 'src', 'app', '(admin)');
    const sections = fs
      .readdirSync(adminDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
    assert.ok(sections.length > 0, 'expected admin page directories under src/app/(admin)');
    assert.deepStrictEqual([...ADMIN_PAGE_SECTIONS].sort(), sections);
  });

  test('no admin page directory is left at the app root (it would render without AuthProvider)', () => {
    const appDir = path.join(__dirname, '..', 'src', 'app');
    const stray = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !['api', 'site'].includes(d.name) && !d.name.startsWith('('))
      .map((d) => d.name);
    assert.deepStrictEqual(stray, []);
    assert.ok(!fs.existsSync(path.join(appDir, 'page.tsx')), 'the admin dashboard belongs in (admin)/page.tsx');
  });
});
