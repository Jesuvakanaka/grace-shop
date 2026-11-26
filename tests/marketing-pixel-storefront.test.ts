// ZP-1200: the browser Meta Pixel on the storefront is behind the pixel gate. With the gate closed (the default) the
// storefront layout and product page return exactly their old tree: no script, no extra markup. No network, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MetaPixel } from '../src/components/storefront/MetaPixel'
import { PixelViewContent } from '../src/components/storefront/PixelViewContent'
import { loadPixelConfigForStorefront, pixelConfigForStorefront } from '../src/lib/marketing/pixel'

const layout = readFileSync('src/app/site/layout.tsx', 'utf8')
const product = readFileSync('src/app/site/p/[slug]/page.tsx', 'utf8')

describe('Pixel on the storefront', () => {
  test('gate closed (default): no config, no database read, so nothing is added to the page', async () => {
    const throwing = new Proxy({}, { get: () => { throw new Error('read') } })
    assert.strictEqual(await loadPixelConfigForStorefront(throwing as never, {}), null)
    assert.strictEqual(await loadPixelConfigForStorefront(throwing as never, { GRACE_MARKETING_LIVE: 'false' }), null)
    assert.strictEqual(pixelConfigForStorefront({ settings: { liveEnabled: false, metaPixelId: '123456789' }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, env: { GRACE_MARKETING_LIVE: 'true' } }), null)
  })

  test('the layout and the product page add the Pixel only inside `pixel ? ... : <the old tree>`', () => {
    // Layout: the old JSX is bound to `tree` untouched, and returned as-is when there is no Pixel.
    assert.match(layout, /const tree = \(\s*\n\s*\/\/ ZP-543/)
    assert.match(layout, /return pixel \? \(\s*<>\s*\{tree\}\s*<MetaPixel pixelId=\{pixel\.pixelId\} \/>\s*<\/>\s*\) : \(\s*tree\s*\);/)
    // Product page: same shape, and never for an owner preview.
    assert.match(product, /const pixel = preview \? null : await getStorefrontPixel\(\);/)
    assert.match(product, /const page = \(\s*<>/)
    assert.match(product, /return pixel \? \(\s*<>\s*\{page\}\s*<PixelViewContent[^>]*\/>\s*<\/>\s*\) : \(\s*page\s*\);/)
    // Neither component is used anywhere else in those files.
    assert.strictEqual(layout.match(/<MetaPixel/g)?.length, 1)
    assert.strictEqual(product.match(/<PixelViewContent/g)?.length, 1)
  })

  test('gate open: the script carries the base code and PageView; ViewContent renders no markup of its own', () => {
    // next/script injects its code in the browser (afterInteractive), so check the element it is given.
    const el = MetaPixel({ pixelId: '123456789012345' }) as { props: { id: string; strategy: string; children: string } }
    assert.strictEqual(el.props.id, 'meta-pixel')
    assert.strictEqual(el.props.strategy, 'afterInteractive')
    assert.match(el.props.children, /connect\.facebook\.net\/en_US\/fbevents\.js/)
    assert.match(el.props.children, /fbq\('init','123456789012345'\);fbq\('track','PageView'\);$/)
    assert.strictEqual(renderToStaticMarkup(createElement(PixelViewContent, { contentId: 'V-0001', name: 'Pink dress' })), '')
    assert.throws(() => MetaPixel({ pixelId: "1');x('" }))
  })
})
