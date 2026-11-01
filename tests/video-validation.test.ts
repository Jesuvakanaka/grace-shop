// ZP-501: product video validation. Pure (no database, no ffmpeg):
// container sniffing, limits, upload body/index parsing, key formats,
// ffprobe result checks, the transcode plan/arguments and HTTP Range parsing.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  isValidPosterKey,
  isValidUploadChunkKey,
  isValidVideoKey,
  isVideoStorageKey,
  privateVideoUrl,
  publicVideoUrl,
  uploadChunkKey,
  videoAssetFromFileName,
} from '../src/lib/storage/video-keys'
import {
  VIDEO_CHUNK_BYTES,
  VIDEO_MAX_DURATION_MS,
  VIDEO_MAX_UPLOAD_BYTES,
  checkProbe,
  parseChunkIndex,
  parseUploadStart,
  sniffVideoContainer,
} from '../src/lib/website/video-validation'
import { buildPosterArgs, buildProbeArgs, buildTranscodeArgs, checkOutput, planTranscode } from '../src/lib/website/video-process'
import { parseRangeHeader } from '../src/lib/website/video-range'

const HEX = 'a'.repeat(32)

/** An ISO-BMFF "ftyp" box: size, "ftyp", major brand, minor version, compatible brands. */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4
  const b = Buffer.alloc(size + 8)
  b.writeUInt32BE(size, 0)
  b.write('ftyp', 4, 'latin1')
  b.write(major, 8, 'latin1')
  b.writeUInt32BE(0, 12)
  compatible.forEach((c, i) => b.write(c, 16 + i * 4, 'latin1'))
  b.write('free', size + 4, 'latin1')
  return new Uint8Array(b)
}

/** EBML header with the given DocType ("webm" or "matroska"). */
function ebml(docType: string): Uint8Array {
  const doc = Buffer.from(docType, 'latin1')
  const body = Buffer.concat([
    Buffer.from([0x42, 0x86, 0x81, 0x01]), // EBMLVersion 1
    Buffer.from([0x42, 0x82, 0x80 | doc.length]),
    doc,
    Buffer.from([0x42, 0x87, 0x81, 0x04]),
  ])
  return new Uint8Array(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length]), body]))
}

describe('sniffVideoContainer: from the bytes only', () => {
  test('MP4 brands are mp4, QuickTime is mov', () => {
    assert.strictEqual(sniffVideoContainer(ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41'])), 'mp4')
    assert.strictEqual(sniffVideoContainer(ftyp('mp42', ['mp42', 'isom'])), 'mp4')
    assert.strictEqual(sniffVideoContainer(ftyp('qt  ', ['qt  '])), 'mov')
  })

  test('an unknown major brand is accepted through a compatible video brand', () => {
    assert.strictEqual(sniffVideoContainer(ftyp('XAVC', ['XAVC', 'mp42', 'iso2'])), 'mp4')
  })

  test('HEIC/AVIF pictures (also ftyp) are refused', () => {
    assert.strictEqual(sniffVideoContainer(ftyp('heic', ['mif1', 'heic'])), null)
    assert.strictEqual(sniffVideoContainer(ftyp('avif', ['avif', 'mif1', 'miaf'])), null)
    assert.strictEqual(sniffVideoContainer(ftyp('mif1', ['mif1', 'mp42'])), null)
  })

  test('WebM is accepted, other Matroska is refused', () => {
    assert.strictEqual(sniffVideoContainer(ebml('webm')), 'webm')
    assert.strictEqual(sniffVideoContainer(ebml('matroska')), null)
  })

  test('legacy QuickTime without ftyp (moov/wide first) is mov', () => {
    const b = Buffer.alloc(16)
    b.writeUInt32BE(8, 0)
    b.write('wide', 4, 'latin1')
    assert.strictEqual(sniffVideoContainer(new Uint8Array(b)), 'mov')
  })

  test('pictures, text, scripts, short and empty input are refused', () => {
    assert.strictEqual(sniffVideoContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), null)
    assert.strictEqual(sniffVideoContainer(new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>'))), null)
    assert.strictEqual(sniffVideoContainer(new Uint8Array(Buffer.from('RIFF\0\0\0\0AVI LIST'))), null)
    assert.strictEqual(sniffVideoContainer(new Uint8Array([0, 0, 0])), null)
    assert.strictEqual(sniffVideoContainer(new Uint8Array()), null)
  })
})

describe('limits', () => {
  test('60 MB, 30 s, chunks small enough for the proxy body buffer (10 MB) and Cloud Run (32 MiB)', () => {
    assert.strictEqual(VIDEO_MAX_UPLOAD_BYTES, 60 * 1024 * 1024)
    assert.strictEqual(VIDEO_MAX_DURATION_MS, 30_000)
    assert.ok(VIDEO_CHUNK_BYTES <= 9 * 1024 * 1024)
    assert.ok(Math.ceil(VIDEO_MAX_UPLOAD_BYTES / VIDEO_CHUNK_BYTES) <= 8)
  })

  test('parseUploadStart: a positive integer size up to 60 MB', () => {
    assert.deepStrictEqual(parseUploadStart({ size: 1000 }), { ok: true, data: { size: 1000, chunks: 1 } })
    assert.deepStrictEqual(parseUploadStart({ size: VIDEO_MAX_UPLOAD_BYTES }), {
      ok: true,
      data: { size: VIDEO_MAX_UPLOAD_BYTES, chunks: Math.ceil(VIDEO_MAX_UPLOAD_BYTES / VIDEO_CHUNK_BYTES) },
    })
    const tooBig = parseUploadStart({ size: VIDEO_MAX_UPLOAD_BYTES + 1 })
    assert.strictEqual(tooBig.ok, false)
    assert.match(!tooBig.ok ? tooBig.error : '', /too large.*60 MB/i)
    for (const bad of [undefined, null, {}, { size: 0 }, { size: -5 }, { size: 1.5 }, { size: '1000' }, { size: 10, extra: 1 }]) {
      assert.strictEqual(parseUploadStart(bad).ok, false, JSON.stringify(bad))
    }
  })

  test('parseChunkIndex: digits only, below the chunk count', () => {
    assert.strictEqual(parseChunkIndex('0', 3), 0)
    assert.strictEqual(parseChunkIndex('2', 3), 2)
    for (const bad of ['3', '-1', '01', '1.0', 'a', '', '../0', '7 ']) assert.strictEqual(parseChunkIndex(bad, 3), null, bad)
  })
})

describe('keys: no path traversal', () => {
  test('video, poster and chunk keys', () => {
    assert.ok(isValidVideoKey(`videos/${HEX}.mp4`))
    assert.ok(isValidPosterKey(`videos/${HEX}.webp`))
    assert.ok(isValidUploadChunkKey(uploadChunkKey(HEX, 7)))
    for (const bad of [
      `videos/${HEX}.MP4`,
      `videos/${HEX.toUpperCase()}.mp4`,
      `videos/../${HEX}.mp4`,
      `videos/${HEX}.mp4/..`,
      `products/${HEX}.mp4`,
      `videos/${HEX.slice(1)}.mp4`,
      `/videos/${HEX}.mp4`,
      `videos\\${HEX}.mp4`,
      `videos/uploads/${HEX}/8.part`,
      `videos/uploads/${HEX}/../0.part`,
      `videos/uploads/x/0.part`,
    ]) {
      assert.strictEqual(isVideoStorageKey(bad), false, bad)
    }
    assert.throws(() => uploadChunkKey('../etc', 0))
    assert.throws(() => uploadChunkKey(HEX, 8))
  })

  test('route file names: <32 hex>.mp4 or .webp only', () => {
    assert.deepStrictEqual(videoAssetFromFileName(`${HEX}.mp4`), { kind: 'video', key: `videos/${HEX}.mp4` })
    assert.deepStrictEqual(videoAssetFromFileName(`${HEX}.webp`), { kind: 'poster', key: `videos/${HEX}.webp` })
    for (const bad of [`${HEX}.mov`, `..%2F${HEX}.mp4`, `../${HEX}.mp4`, `${HEX}.mp4.`, '', null, 5]) {
      assert.strictEqual(videoAssetFromFileName(bad), null, String(bad))
    }
  })

  test('URLs', () => {
    assert.strictEqual(publicVideoUrl(`videos/${HEX}.mp4`), `/api/videos/public/${HEX}.mp4`)
    assert.strictEqual(privateVideoUrl(`videos/${HEX}.webp`), `/api/videos/${HEX}.webp`)
    assert.throws(() => publicVideoUrl(`products/${HEX}.webp`))
  })
})

/** A minimal ffprobe -show_format -show_streams JSON result. */
function probe(over: { format?: Record<string, unknown>; streams?: Record<string, unknown>[] } = {}) {
  return {
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.000000', ...over.format },
    streams: over.streams ?? [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', duration: '5.0' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }
}

describe('checkProbe', () => {
  test('a 5 s portrait clip is accepted with its display size', () => {
    assert.deepStrictEqual(checkProbe(probe(), 'mp4'), {
      ok: true,
      data: { width: 1080, height: 1920, durationMs: 5000, fps: 30, hdr: null },
    })
  })

  test('HDR transfer is detected: HLG (arib-std-b67) and PQ (smpte2084)', () => {
    const hdr = (color_transfer: string) =>
      checkProbe(
        probe({ streams: [{ codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1', color_transfer, pix_fmt: 'yuv420p10le' }] }),
        'mov',
      )
    assert.strictEqual((hdr('arib-std-b67') as { data: { hdr: string } }).data.hdr, 'arib-std-b67')
    assert.strictEqual((hdr('smpte2084') as { data: { hdr: string } }).data.hdr, 'smpte2084')
    assert.strictEqual((hdr('bt709') as { data: { hdr: string | null } }).data.hdr, null)
  })

  test('rotation metadata (phones) swaps the display size', () => {
    const rotated = probe({
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        },
      ],
    })
    const r = checkProbe(rotated, 'mov')
    assert.ok(r.ok)
    assert.strictEqual(r.data.width, 1080)
    assert.strictEqual(r.data.height, 1920)
    assert.ok(Math.abs(r.data.fps - 29.97) < 0.01)
  })

  test('longer than 30 s is refused with the length', () => {
    const r = checkProbe(probe({ format: { duration: '42.3' } }), 'mp4')
    assert.strictEqual(r.ok, false)
    assert.match(!r.ok ? r.error : '', /42 s.*30 s/)
  })

  test('just over 30 s (container rounding) is accepted', () => {
    assert.ok(checkProbe(probe({ format: { duration: '30.2' } }), 'mp4').ok)
  })

  test('no video stream, unknown duration, a container that does not match the bytes, or absurd sizes are refused', () => {
    const audioOnly = probe({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] })
    assert.match((checkProbe(audioOnly, 'mp4') as { error: string }).error, /no video/i)
    const noDuration = probe({
      format: { duration: 'N/A' },
      streams: [{ codec_type: 'video', width: 720, height: 1280, avg_frame_rate: '30/1' }],
    })
    assert.strictEqual(checkProbe(noDuration, 'mp4').ok, false)
    assert.strictEqual(checkProbe(probe({ format: { format_name: 'matroska,webm' } }), 'mp4').ok, false)
    assert.strictEqual(checkProbe(probe(), 'webm').ok, false)
    const huge = probe({ streams: [{ codec_type: 'video', width: 20000, height: 20000, avg_frame_rate: '30/1' }] })
    assert.strictEqual(checkProbe(huge, 'mp4').ok, false)
    // At most 4K (3840x2160) in either orientation.
    const sized = (width: number, height: number) =>
      checkProbe(probe({ streams: [{ codec_type: 'video', width, height, avg_frame_rate: '30/1' }] }), 'mp4').ok
    assert.strictEqual(sized(3840, 2160), true)
    assert.strictEqual(sized(2160, 3840), true)
    assert.strictEqual(sized(4096, 2160), false)
    assert.strictEqual(sized(3000, 3000), false)
    assert.strictEqual(sized(8192, 100), false)
    assert.strictEqual(checkProbe(null, 'mp4').ok, false)
    assert.strictEqual(checkProbe({ streams: 'x' }, 'mp4').ok, false)
  })

  test('WebM probes as matroska,webm', () => {
    assert.ok(checkProbe(probe({ format: { format_name: 'matroska,webm' } }), 'webm').ok)
  })
})

describe('transcode plan and arguments', () => {
  test('portrait fits 720x1280, landscape 1280x720, never upscaled, even sizes', () => {
    assert.deepStrictEqual(planTranscode({ width: 1080, height: 1920, fps: 30 }), { width: 720, height: 1280, fps: null })
    assert.deepStrictEqual(planTranscode({ width: 1920, height: 1080, fps: 60 }), { width: 1280, height: 720, fps: 30 })
    assert.deepStrictEqual(planTranscode({ width: 1080, height: 1350, fps: 25 }), { width: 720, height: 900, fps: null })
    assert.deepStrictEqual(planTranscode({ width: 480, height: 640, fps: 30 }), { width: 480, height: 640, fps: null })
    assert.deepStrictEqual(planTranscode({ width: 721, height: 1281, fps: 30 }).width % 2, 0)
    assert.deepStrictEqual(planTranscode({ width: 1000, height: 1000, fps: 30 }), { width: 720, height: 720, fps: null })
  })

  test('ffmpeg: input format forced, file protocol only, H.264 High yuv420p ~2 Mbps, faststart, no audio, no metadata', () => {
    const args = buildTranscodeArgs('in.bin', 'out.mp4', { width: 720, height: 1280, fps: 30 }, 'mov')
    const joined = args.join(' ')
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    assert.ok(args.indexOf('-f') < args.indexOf('-i'), 'input format before -i')
    assert.strictEqual(after('-f'), 'mov')
    assert.strictEqual(after('-protocol_whitelist'), 'file')
    assert.strictEqual(after('-i'), 'in.bin')
    assert.strictEqual(after('-c:v'), 'libx264')
    assert.strictEqual(after('-profile:v'), 'high')
    assert.strictEqual(after('-pix_fmt'), 'yuv420p')
    assert.strictEqual(after('-b:v'), '2M')
    assert.strictEqual(after('-movflags'), '+faststart')
    assert.strictEqual(after('-map_metadata'), '-1')
    assert.ok(args.includes('-an'))
    assert.match(after('-vf'), /^scale=720:1280,format=yuv420p,fps=30$/)
    assert.strictEqual(args.at(-1), 'out.mp4')
    // Bounded thread pools (memory): decoder and encoder.
    assert.deepStrictEqual(args.flatMap((a, i) => (a === '-threads' ? [args[i + 1]] : [])), ['2', '2'])
    const t1 = buildTranscodeArgs('in', 'out', { width: 2, height: 2, fps: null }, 'mp4', 1)
    assert.deepStrictEqual(t1.flatMap((a, i) => (a === '-threads' ? [t1[i + 1]] : [])), ['1', '1'])
    assert.ok(!/[;&|`$]/.test(joined), 'nothing shell-like')
    assert.strictEqual(buildTranscodeArgs('a', 'b', { width: 2, height: 2, fps: null }, 'webm')[args.indexOf('-f') + 1], 'matroska')
  })

  test('output caps, decoder frame cap and SDR BT.709 tags', () => {
    const args = buildTranscodeArgs('in.bin', 'out.mp4', { width: 720, height: 1280, fps: null }, 'mp4')
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    const input = args.indexOf('-i')
    assert.strictEqual(after('-t'), '30.5')
    assert.ok(args.indexOf('-t') > input, '-t is an output option')
    assert.strictEqual(after('-fs'), String(40 * 1024 * 1024))
    assert.ok(args.indexOf('-max_pixels') < input, '-max_pixels bounds the decoder')
    assert.strictEqual(after('-max_pixels'), String(3840 * 2160))
    assert.strictEqual(after('-color_primaries'), 'bt709')
    assert.strictEqual(after('-color_trc'), 'bt709')
    assert.strictEqual(after('-colorspace'), 'bt709')
    assert.ok(!after('-vf').includes('tonemap'), 'SDR input: no tone mapping')
    assert.ok(buildProbeArgs('in', 'mp4').indexOf('-max_pixels') < buildProbeArgs('in', 'mp4').indexOf('-i'))
  })

  test('HDR (HLG/PQ) is tone-mapped to SDR BT.709: zscale + tonemap=hable, or a matrix conversion without zscale', () => {
    const plan = { width: 720, height: 1280, fps: 30 }
    for (const trc of ['arib-std-b67', 'smpte2084'] as const) {
      const vf = (mode: 'zscale' | 'matrix') => {
        const a = buildTranscodeArgs('in', 'out', plan, 'mov', 2, { hdr: trc, toneMap: mode })
        return a[a.indexOf('-vf') + 1]
      }
      const z = vf('zscale')
      assert.match(z, new RegExp(`zscale=tin=${trc}:pin=bt2020:min=bt2020nc:t=linear:npl=100`))
      assert.match(z, /tonemap=tonemap=hable:desat=0/)
      assert.match(z, /zscale=t=bt709:m=bt709:p=bt709:r=tv/)
      assert.match(z, /format=yuv420p/)
      assert.match(z, /fps=30/)
      const m = vf('matrix')
      assert.ok(!m.includes('zscale') && !m.includes('tonemap'))
      assert.match(m, /in_color_matrix=bt2020/)
      assert.match(m, /out_color_matrix=bt709/)
      for (const chain of [z, m]) assert.match(chain, /setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709/)
    }
  })

  test('checkOutput: the encoded file must be H.264, the planned size, at most 30.5 s and not longer than the input claimed', () => {
    const out = (duration: string, extra: Record<string, unknown> = {}) => ({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, ...extra }],
    })
    const plan = { width: 720, height: 1280, fps: null }
    assert.deepStrictEqual(checkOutput(out('5.000'), plan, 5000), { ok: true, data: { durationMs: 5000 } })
    // A WebM claiming 10 s but holding minutes: encoding stops at -t 30.5, far beyond the claim.
    assert.match((checkOutput(out('30.500'), plan, 10_000) as { error: string }).error, /longer than/i)
    assert.strictEqual(checkOutput(out('31.2'), plan, 31_000).ok, false)
    assert.strictEqual(checkOutput(out('5', { codec_name: 'hevc' }), plan, 5000).ok, false)
    assert.strictEqual(checkOutput(out('5', { width: 1080 }), plan, 5000).ok, false)
    assert.strictEqual(checkOutput({ streams: [] }, plan, 5000).ok, false)
    // Rounding: up to 1 s over the claim is fine.
    assert.ok(checkOutput(out('5.9'), plan, 5000).ok)
  })

  test('ffprobe and poster arguments force the format and the file protocol', () => {
    const p = buildProbeArgs('in.bin', 'webm')
    assert.deepStrictEqual(p.slice(p.indexOf('-f'), p.indexOf('-f') + 2), ['-f', 'matroska'])
    assert.ok(p.includes('-protocol_whitelist'))
    assert.strictEqual(p.at(-1), 'in.bin')
    const poster = buildPosterArgs('out.mp4', 1.0)
    assert.ok(poster.includes('-frames:v'))
    assert.strictEqual(poster.at(-1), '-')
  })
})

describe('parseRangeHeader', () => {
  const size = 1000
  test('no header or another unit: the whole file', () => {
    assert.deepStrictEqual(parseRangeHeader(null, size), { kind: 'full' })
    assert.deepStrictEqual(parseRangeHeader('items=0-5', size), { kind: 'full' })
  })
  test('single byte ranges', () => {
    assert.deepStrictEqual(parseRangeHeader('bytes=0-1', size), { kind: 'partial', start: 0, end: 1 })
    assert.deepStrictEqual(parseRangeHeader('bytes=0-', size), { kind: 'partial', start: 0, end: 999 })
    assert.deepStrictEqual(parseRangeHeader('bytes=500-', size), { kind: 'partial', start: 500, end: 999 })
    assert.deepStrictEqual(parseRangeHeader('bytes=990-5000', size), { kind: 'partial', start: 990, end: 999 })
    assert.deepStrictEqual(parseRangeHeader('bytes=-100', size), { kind: 'partial', start: 900, end: 999 })
    assert.deepStrictEqual(parseRangeHeader('bytes=-5000', size), { kind: 'partial', start: 0, end: 999 })
    assert.deepStrictEqual(parseRangeHeader(' bytes = 10 - 20 ', size), { kind: 'partial', start: 10, end: 20 })
  })
  test('malformed, multi-range or overflowing headers are ignored: the whole file (RFC 9110)', () => {
    for (const ignored of ['bytes=', 'bytes=a-b', 'bytes=0-1,5-6', 'bytes=--1', 'bytes=1.5-2', 'bytes=99999999999999999999-', 'bytes=5-4', 'garbage', '=0-1']) {
      assert.deepStrictEqual(parseRangeHeader(ignored, size), { kind: 'full' }, ignored)
    }
  })
  test('a well-formed range that cannot be satisfied is 416', () => {
    for (const bad of ['bytes=1000-', 'bytes=1000-1001', 'bytes=-0']) {
      assert.deepStrictEqual(parseRangeHeader(bad, size), { kind: 'unsatisfiable' }, bad)
    }
    assert.deepStrictEqual(parseRangeHeader('bytes=0-1', 0), { kind: 'unsatisfiable' })
  })
})
