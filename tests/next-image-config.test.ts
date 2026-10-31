/**
 * ZP-485 review D1: the image optimiser (/_next/image?url=...) must only fetch
 * brand assets and stored product images, never arbitrary routes such as
 * /api/products. Uses Next's own matcher on the real next.config.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasLocalMatch } from 'next/dist/shared/lib/match-local-pattern';
import nextConfig from '../next.config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const localPatterns = nextConfig.images?.localPatterns;

describe('next/image uses in src', () => {
  // ZP-484: with /api/images/* the optimiser may still fetch private stored
  // pictures. Every <Image> must be unoptimized or a static /brand asset, so
  // nothing relies on the optimiser for product photos.
  test('every <Image> is unoptimized or a literal /brand/ src', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx|jsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), 'src'));
    let checked = 0;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!/from ['"]next\/image['"]/.test(text)) continue;
      for (const m of text.matchAll(/<Image\b[\s\S]*?\/>/g)) {
        checked++;
        const ok = /\bunoptimized\b/.test(m[0]) || /\bsrc=["']\/brand\//.test(m[0]);
        assert.ok(ok, `${path.relative(process.cwd(), file)}: ${m[0].slice(0, 80)}`);
      }
    }
    assert.ok(checked > 0);
  });
});

describe('next.config images.localPatterns', () => {
  test('is configured (without it every local path is optimisable)', () => {
    assert.ok(Array.isArray(localPatterns) && localPatterns.length > 0);
  });

  test('allows brand assets and stored images, without a query string', () => {
    for (const url of ['/brand/vyra-lockup.svg', '/brand/vyra-icon-192.png', '/api/images/abc.webp']) {
      assert.strictEqual(hasLocalMatch(localPatterns, url), true, url);
    }
  });

  // ZP-484: optimised sizes are cached for max(minimumCacheTTL, upstream max-age)
  // and Next cannot invalidate them, so this bounds how long an unpublished
  // picture can still be served through /_next/image.
  test('minimumCacheTTL is 300 s, matching the public image max-age', () => {
    assert.strictEqual(nextConfig.images?.minimumCacheTTL, 300);
  });

  test('blocks every other route and any query string', () => {
    for (const url of [
      '/api/products',
      '/api/auth/session',
      '/api/dashboard',
      '/products',
      '/',
      '/site',
      '/brand/vyra-lockup.svg?x=1',
      '/api/images/abc.webp?w=1',
      '/brandx/a.png',
      // ZP-484: storefront photos never go through the optimiser (it keeps
      // serving a cached size after the picture is unpublished).
      '/api/images/public/abc.webp',
      '/api/images/public/abc.webp?w=640',
      '/api/images/a/b.webp',
    ]) {
      assert.strictEqual(hasLocalMatch(localPatterns, url), false, url);
    }
  });
});
