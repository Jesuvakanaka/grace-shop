/**
 * ZP-485 review D1: the image optimiser (/_next/image?url=...) must only fetch
 * brand assets and stored product images, never arbitrary routes such as
 * /api/products. Uses Next's own matcher on the real next.config.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasLocalMatch } from 'next/dist/shared/lib/match-local-pattern';
import nextConfig from '../next.config';

const localPatterns = nextConfig.images?.localPatterns;

describe('next.config images.localPatterns', () => {
  test('is configured (without it every local path is optimisable)', () => {
    assert.ok(Array.isArray(localPatterns) && localPatterns.length > 0);
  });

  test('allows brand assets and stored images, without a query string', () => {
    for (const url of ['/brand/vyra-lockup.svg', '/brand/vyra-icon-192.png', '/api/images/abc.webp', '/api/images/public/abc.webp']) {
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
    ]) {
      assert.strictEqual(hasLocalMatch(localPatterns, url), false, url);
    }
  });
});
