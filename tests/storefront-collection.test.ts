/**
 * ZP-489 / ZP-514: canonical URLs of the storefront addresses
 * (absoluteSiteUrl in src/lib/storefront/public-url.ts), used by the folded
 * routes' metadata (route-metadata.ts) and the piece URL. The grid listing
 * pages, their query parsing and paging went away in ZP-514 (one view).
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { absoluteSiteUrl, cleanHost } from '../src/lib/storefront/public-url'
import { productAbsoluteUrl } from '../src/lib/storefront/product-route'
import { siteBaseForHost } from '../src/lib/storefront/paths'

describe('canonical URL (shared absoluteSiteUrl rule)', () => {
  const HOSTS = ['vyra.example', 'www.vyra.example']
  // The site base comes from the same Host + config the proxy uses.
  const canon = (host: string | null, path: string, storefrontHosts: string[] = HOSTS) =>
    absoluteSiteUrl({ base: siteBaseForHost(host, { storefrontHosts, adminHosts: [] }), path, storefrontHosts, host })

  test('storefront host: always https on the FIRST configured host, never the request Host', () => {
    assert.strictEqual(canon('vyra.example', '/shop'), 'https://vyra.example/shop')
    assert.strictEqual(canon('www.vyra.example', '/shop'), 'https://vyra.example/shop', 'www and apex agree')
    assert.strictEqual(canon('WWW.VYRA.EXAMPLE', '/collections/sets'), 'https://vyra.example/collections/sets')
    assert.strictEqual(
      absoluteSiteUrl({ base: '', path: '/new', storefrontHosts: HOSTS, host: 'evil.example' }),
      'https://vyra.example/new',
      'a spoofed Host never reaches a storefront URL',
    )
    assert.strictEqual(absoluteSiteUrl({ base: '', path: '/new', storefrontHosts: [], host: 'vyra.example' }), null)
    assert.strictEqual(
      absoluteSiteUrl({ base: '', path: '/new', storefrontHosts: ['bad host', 'vyra.example'], host: null }),
      'https://vyra.example/new',
      'first VALID configured host',
    )
  })

  test('admin/UAT host: validated Host plus /site; http only for local hosts', () => {
    assert.strictEqual(canon('grace-uat.a.run.app', '/shop'), 'https://grace-uat.a.run.app/site/shop')
    assert.strictEqual(canon('evil.example', '/shop'), 'https://evil.example/site/shop', 'not a storefront host: UAT rule')
    assert.strictEqual(canon('localhost:3489', '/collections/sets', []), 'http://localhost:3489/site/collections/sets')
    assert.strictEqual(canon('127.0.0.1:3489', '/new', []), 'http://127.0.0.1:3489/site/new')
    assert.strictEqual(canon('uat.example.com:8443', '/shop', []), 'https://uat.example.com:8443/site/shop')
  })

  test('malformed Host gives null (canonical omitted), including ports above 65535', () => {
    for (const host of [null, '', 'evil.example/path', 'a b', 'evil.example:65536', 'evil.example:0', 'evil.example:99999', 'user@evil.example', '-bad.example', `${'a'.repeat(300)}.example`]) {
      assert.strictEqual(canon(host, '/shop', []), null, String(host))
    }
    assert.strictEqual(cleanHost('Shop.Example:65535'), 'shop.example:65535')
  })

  test('the piece URL uses the same helper', () => {
    assert.strictEqual(
      productAbsoluteUrl({ slug: 'lime-dress', storefrontHosts: HOSTS, host: 'evil.example' }),
      'https://vyra.example/p/lime-dress',
    )
    assert.strictEqual(productAbsoluteUrl({ slug: 'lime-dress', storefrontHosts: [], host: 'evil.example:70000' }), null)
  })
})
