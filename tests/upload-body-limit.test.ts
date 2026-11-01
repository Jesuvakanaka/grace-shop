/**
 * ZP-504: src/proxy.ts runs on every /api route (the storefront host must 404
 * private APIs, so uploads cannot be excluded from its matcher). Next 16
 * buffers a request body that passes through the proxy only up to
 * experimental.proxyClientMaxBodySize (default 10 MB) and silently truncates
 * the rest. The limit must hold the largest single-request upload: a photo of
 * IMAGE_MAX_UPLOAD_BYTES plus multipart framing, and one video chunk.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import nextConfig from '../next.config'
import { config as proxyConfig } from '../src/proxy'
import { decideHostRouting } from '../src/lib/host-routing'
import { IMAGE_MAX_UPLOAD_BYTES } from '../src/lib/storage/images'
import { VIDEO_CHUNK_BYTES } from '../src/lib/website/video-validation'

/** Room for the multipart boundary, part headers and the form field name. */
const MULTIPART_HEADROOM = 64 * 1024
const NEXT_DEFAULT = 10 * 1024 * 1024

const limit = nextConfig.experimental?.proxyClientMaxBodySize

describe('proxy body limit', () => {
  test('is a byte count (no unit string to misread)', () => {
    assert.strictEqual(typeof limit, 'number')
  })
  test('holds the largest photo upload with multipart framing', () => {
    assert.ok((limit as number) >= IMAGE_MAX_UPLOAD_BYTES + MULTIPART_HEADROOM, `${limit} < photo max ${IMAGE_MAX_UPLOAD_BYTES}`)
    assert.ok((limit as number) > NEXT_DEFAULT)
  })
  test('holds one video chunk', () => {
    assert.ok((limit as number) >= VIDEO_CHUNK_BYTES + MULTIPART_HEADROOM)
  })
  test('stays bounded (every request through the proxy may be buffered in memory)', () => {
    assert.ok((limit as number) <= 32 * 1024 * 1024)
  })
})

describe('upload routes still pass through the proxy', () => {
  test('the matcher covers /api/upload', () => {
    const [matcher] = proxyConfig.matcher
    assert.match('/api/upload', new RegExp(`^${matcher}$`))
  })
  test('the storefront host 404s /api/upload', () => {
    const cfg = { storefrontHosts: ['vyra.example'], adminHosts: [] }
    assert.deepStrictEqual(decideHostRouting({ host: 'vyra.example', pathname: '/api/upload' }, cfg), { action: 'not-found' })
  })
})
