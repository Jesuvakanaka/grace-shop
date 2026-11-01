// Product video processing (ZP-501). Server only.
//
// Pipeline for one uploaded file (already on local temp disk):
//   1. sniff the container from the first bytes (video-validation.ts)
//   2. ffprobe, forced to that demuxer: duration, display size, video stream
//   3. ffmpeg: H.264 High yuv420p ~2 Mbps, max 720x1280 (portrait) or
//      1280x720 (landscape) keeping the aspect ratio, never upscaled, at most
//      30 fps, no audio (-an), no metadata or chapters, +faststart
//   4. one poster frame (PNG from ffmpeg -> WebP via sharp)
//   5. content-hashed keys videos/<sha256/32>.mp4 and .webp
//
// ffmpeg/ffprobe run through child_process.spawn with an argument array
// (never a shell), a hard timeout (SIGKILL) and bounded output capture.
// Inputs are read with `-protocol_whitelist file` and an explicit demuxer,
// so a crafted file cannot make ffmpeg open URLs, playlists or other files.
//
// Binaries: GRACE_FFMPEG_PATH / GRACE_FFPROBE_PATH, else "ffmpeg"/"ffprobe"
// on PATH. The Cloud Run image installs Debian's ffmpeg (Dockerfile); on
// Windows install it (e.g. `winget install Gyan.FFmpeg.Essentials`) or set
// the two variables. See docs/storefront/videos.md.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  checkProbe,
  sniffVideoContainer,
  VIDEO_DURATION_TOLERANCE_MS,
  VIDEO_MAX_DURATION_MS,
  VIDEO_MAX_INPUT_PIXELS,
  VIDEO_REFUSALS,
  type HdrTransfer,
  type ProbedVideo,
  type VideoContainer,
} from './video-validation'

if (typeof window !== 'undefined') throw new Error('video-process is server-only')

export const VIDEO_MAX_LONG_SIDE = 1280
export const VIDEO_MAX_SHORT_SIDE = 720
export const VIDEO_MAX_FPS = 30
export const VIDEO_BITRATE = '2M'
export const POSTER_WEBP_QUALITY = 80

export const PROBE_TIMEOUT_MS = 20_000
export const TRANSCODE_TIMEOUT_MS = 150_000
export const POSTER_TIMEOUT_MS = 20_000

/** The input is not an acceptable video (shown to the owner as a 400/422). */
export class VideoRejectedError extends Error {}

export type TranscodePlan = { width: number; height: number; fps: number | null }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Output size: fit 720x1280 (portrait/square) or 1280x720 (landscape), never upscale, even numbers. */
export function planTranscode(input: Pick<ProbedVideo, 'width' | 'height' | 'fps'>): TranscodePlan {
  const landscape = input.width > input.height
  const boxW = landscape ? VIDEO_MAX_LONG_SIDE : VIDEO_MAX_SHORT_SIDE
  const boxH = landscape ? VIDEO_MAX_SHORT_SIDE : VIDEO_MAX_LONG_SIDE
  const scale = Math.min(1, boxW / input.width, boxH / input.height)
  let width = even(input.width * scale)
  let height = even(input.height * scale)
  // Rounding up to an even number must not leave the box.
  if (width > boxW) width = boxW
  if (height > boxH) height = boxH
  return { width, height, fps: input.fps > VIDEO_MAX_FPS + 0.5 ? VIDEO_MAX_FPS : null }
}

const DEMUXER: Record<VideoContainer, string> = { mp4: 'mov', mov: 'mov', webm: 'matroska' }

/**
 * Input options shared by ffprobe and ffmpeg: explicit demuxer, local files
 * only, and a decoder frame-size ceiling (`-max_pixels`, 4K) so a stream that
 * changes resolution mid-way cannot make the decoder allocate huge frames.
 */
function inputArgs(input: string, container: VideoContainer): string[] {
  return [
    '-protocol_whitelist', 'file',
    '-max_pixels', String(VIDEO_MAX_INPUT_PIXELS),
    '-f', DEMUXER[container], '-i', input,
  ]
}

/** Encoding stops here whatever the container claims (30 s + rounding). */
export const OUTPUT_MAX_SECONDS = (VIDEO_MAX_DURATION_MS + VIDEO_DURATION_TOLERANCE_MS) / 1000
/** Output file size ceiling (`-fs`); ~2.5 Mbps x 30.5 s is under 10 MB, so only a runaway encode reaches it. */
export const OUTPUT_MAX_BYTES = 40 * 1024 * 1024

export type ToneMapMode = 'zscale' | 'matrix'

/**
 * Filters for one transcode. SDR: scale (+fps). HDR (HLG/PQ, e.g. iPhone):
 * - 'zscale' (libzimg; Debian's ffmpeg has it, the Dockerfile checks):
 *   scale, linearise from BT.2020 + the HDR transfer, tone-map with Hable,
 *   convert to BT.709 primaries/transfer/matrix, 8-bit 4:2:0.
 * - 'matrix' (fallback when zscale is missing): a BT.2020 -> BT.709 matrix
 *   conversion in the scaler. Colours are flatter, but never unplayable.
 */
export function buildVideoFilters(plan: TranscodePlan, hdr: HdrTransfer | null, mode: ToneMapMode): string {
  const filters: string[] = []
  if (!hdr) {
    filters.push(`scale=${plan.width}:${plan.height}`)
  } else if (mode === 'zscale') {
    filters.push(
      `scale=${plan.width}:${plan.height}`,
      `zscale=tin=${hdr}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0',
      'zscale=t=bt709:m=bt709:p=bt709:r=tv',
    )
  } else {
    filters.push(`scale=${plan.width}:${plan.height}:in_color_matrix=bt2020:out_color_matrix=bt709:out_range=tv`)
  }
  filters.push('format=yuv420p')
  // Tag the frames BT.709 (newer ffmpeg takes colour tags from the frames, so
  // -color_trc alone would leave e.g. "smpte2084" on the matrix fallback).
  if (hdr) filters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
  if (plan.fps) filters.push(`fps=${plan.fps}`)
  return filters.join(',')
}

let filterSupport: Promise<ToneMapMode> | null = null

/** 'zscale' when this ffmpeg has the zscale and tonemap filters, else 'matrix'. Checked once. */
export function detectToneMapMode(ffmpeg: string): Promise<ToneMapMode> {
  filterSupport ??= runTool(ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 10_000, maxStdoutBytes: 1024 * 1024 })
    .then((out) => {
      const text = out.toString('utf8')
      return /\szscale\s/.test(text) && /\stonemap\s/.test(text) ? 'zscale' : 'matrix'
    })
    .catch(() => 'matrix' as const)
  return filterSupport
}

export function buildProbeArgs(input: string, container: VideoContainer): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...inputArgs(input, container)]
}

/**
 * Decoder and encoder threads. Bounded so memory stays predictable: with
 * "auto" ffmpeg sizes its thread pools from the host's CPU count (466 MB
 * peak on an 18-core machine vs ~140 MB with 2). GRACE_VIDEO_THREADS overrides.
 */
export function videoThreads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.GRACE_VIDEO_THREADS)
  return Number.isInteger(n) && n >= 1 && n <= 16 ? n : 2
}

export function buildTranscodeArgs(
  input: string,
  output: string,
  plan: TranscodePlan,
  container: VideoContainer,
  threads = 2,
  options: { hdr?: HdrTransfer | null; toneMap?: ToneMapMode } = {},
): string[] {
  const t = String(Math.max(1, Math.min(16, Math.floor(threads))))
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-threads', t,
    ...inputArgs(input, container),
    '-threads', t, '-filter_threads', '1',
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-map_metadata', '-1', '-map_chapters', '-1',
    // Hard output caps, whatever the container claims (duration bypass).
    '-t', String(OUTPUT_MAX_SECONDS), '-fs', String(OUTPUT_MAX_BYTES),
    '-vf', buildVideoFilters(plan, options.hdr ?? null, options.toneMap ?? 'zscale'),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-b:v', VIDEO_BITRATE, '-maxrate', '2500k', '-bufsize', '4M',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ]
}

/** Probe of the transcoded MP4 (no demuxer forcing needed: we wrote it). */
export function buildOutputProbeArgs(file: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-protocol_whitelist', 'file', '-f', 'mp4', '-i', file]
}

/**
 * Check the encoded file: one H.264 stream of the planned size, at most
 * 30.5 s, and not more than 1 s longer than the input claimed. A container
 * that under-reports its duration (e.g. a WebM claiming 10 s but holding
 * minutes) is cut at -t 30.5 by ffmpeg and refused here.
 */
export function checkOutput(
  probe: unknown,
  plan: TranscodePlan,
  claimedMs: number,
): { ok: true; data: { durationMs: number } } | { ok: false; error: string } {
  const p = probe as { format?: { duration?: unknown }; streams?: unknown } | null
  const streams = Array.isArray(p?.streams) ? (p!.streams as Record<string, unknown>[]) : []
  const video = streams.filter((s) => s && s.codec_type === 'video')
  const seconds = Number(p?.format?.duration)
  if (video.length !== 1 || !Number.isFinite(seconds) || seconds <= 0) return { ok: false, error: VIDEO_REFUSALS.unreadable }
  const v = video[0]
  if (v.codec_name !== 'h264' || v.width !== plan.width || v.height !== plan.height) {
    return { ok: false, error: VIDEO_REFUSALS.unreadable }
  }
  const durationMs = Math.round(seconds * 1000)
  if (durationMs > OUTPUT_MAX_SECONDS * 1000 + 100) return { ok: false, error: VIDEO_REFUSALS.unreadable }
  if (durationMs > claimedMs + 1000) {
    return {
      ok: false,
      error: `The video is longer than its file says (${Math.round(claimedMs / 1000)} s). Export it again as MP4, at most ${VIDEO_MAX_DURATION_MS / 1000} s.`,
    }
  }
  return { ok: true, data: { durationMs } }
}

/** One PNG frame at `atSeconds` of the transcoded MP4, written to stdout. */
export function buildPosterArgs(video: string, atSeconds: number): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-ss', atSeconds.toFixed(2),
    '-protocol_whitelist', 'file', '-f', 'mp4', '-i', video,
    '-frames:v', '1', '-an', '-map_metadata', '-1',
    '-f', 'image2pipe', '-c:v', 'png', '-',
  ]
}

export function ffmpegPath(env: Record<string, string | undefined> = process.env): string {
  return env.GRACE_FFMPEG_PATH?.trim() || 'ffmpeg'
}
export function ffprobePath(env: Record<string, string | undefined> = process.env): string {
  return env.GRACE_FFPROBE_PATH?.trim() || 'ffprobe'
}

/** Temp folder for processing: GRACE_VIDEO_TMP_DIR, else os.tmpdir() (TEMP on Windows, /tmp on Cloud Run). */
export function videoTempRoot(env: Record<string, string | undefined> = process.env): string {
  return env.GRACE_VIDEO_TMP_DIR?.trim() || os.tmpdir()
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly reason: 'timeout' | 'exit' | 'spawn' | 'output',
    readonly stderr: string,
  ) {
    super(message)
  }
}

const STDERR_CAP = 16 * 1024

/**
 * Run a binary with an argument array (shell: false), a timeout and capped
 * output. Resolves with stdout; rejects with ToolError.
 */
export function runTool(
  bin: string,
  args: string[],
  options: { timeoutMs: number; maxStdoutBytes: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new ToolError(`${path.basename(bin)} could not start`, 'spawn', error instanceof Error ? error.message : ''))
      return
    }
    const out: Buffer[] = []
    let outBytes = 0
    let stderr = ''
    let failure: ToolError | null = null
    const fail = (e: ToolError) => {
      if (!failure) failure = e
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => fail(new ToolError(`${path.basename(bin)} timed out`, 'timeout', stderr)), options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length
      if (outBytes > options.maxStdoutBytes) return fail(new ToolError(`${path.basename(bin)} output too large`, 'output', stderr))
      out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8').slice(0, STDERR_CAP - stderr.length)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(failure ?? new ToolError(`${path.basename(bin)} could not start`, 'spawn', error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure) return reject(failure)
      if (code !== 0) return reject(new ToolError(`${path.basename(bin)} exited with ${code}`, 'exit', stderr))
      resolve(Buffer.concat(out))
    })
  })
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex').slice(0, 32)
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of createReadStream(file, { start: 0, end: bytes - 1 })) chunks.push(chunk as Buffer)
  return new Uint8Array(Buffer.concat(chunks))
}

export type ProcessedVideo = {
  /** Absolute path of the transcoded MP4 inside `workDir` (deleted by cleanup). */
  videoFile: string
  videoHash: string
  videoBytes: number
  poster: Buffer
  posterHash: string
  width: number
  height: number
  durationMs: number
  sourceContainer: VideoContainer
  /** HDR transfer of the input (tone-mapped), or null for SDR. */
  hdr: HdrTransfer | null
  toneMap: ToneMapMode | null
}

export type ProcessDeps = {
  ffmpeg?: string
  ffprobe?: string
  threads?: number
  /** Force the HDR path (tests); default: detected from `ffmpeg -filters`. */
  toneMap?: ToneMapMode
  timeouts?: { probe?: number; transcode?: number; poster?: number }
}

/**
 * Probe, transcode and extract a poster for `inputFile`. Output files are
 * written inside `workDir` (the caller deletes it). Throws VideoRejectedError
 * for anything that is not an acceptable clip; ToolError/other errors for
 * server-side failures.
 */
export async function processVideoFile(inputFile: string, workDir: string, deps: ProcessDeps = {}): Promise<ProcessedVideo> {
  const ffmpeg = deps.ffmpeg ?? ffmpegPath()
  const ffprobe = deps.ffprobe ?? ffprobePath()
  const t = deps.timeouts ?? {}

  const container = sniffVideoContainer(await readHead(inputFile, 256))
  if (!container) throw new VideoRejectedError(VIDEO_REFUSALS.notVideo)

  let probeJson: unknown
  try {
    const out = await runTool(ffprobe, buildProbeArgs(inputFile, container), {
      timeoutMs: t.probe ?? PROBE_TIMEOUT_MS,
      maxStdoutBytes: 1024 * 1024,
    })
    probeJson = JSON.parse(out.toString('utf8'))
  } catch (error) {
    if (error instanceof ToolError && error.reason === 'spawn') throw error
    // The decoder refused a frame above -max_pixels (4K): say so.
    if (error instanceof ToolError && /exceeds specified max pixel count/i.test(error.stderr)) {
      throw new VideoRejectedError(VIDEO_REFUSALS.tooBig)
    }
    throw new VideoRejectedError(VIDEO_REFUSALS.unreadable)
  }
  const probed = checkProbe(probeJson, container)
  if (!probed.ok) throw new VideoRejectedError(probed.error)

  const plan = planTranscode(probed.data)
  const toneMap = probed.data.hdr ? (deps.toneMap ?? (await detectToneMapMode(ffmpeg))) : 'zscale'
  const videoFile = path.join(workDir, 'out.mp4')
  try {
    const args = buildTranscodeArgs(inputFile, videoFile, plan, container, deps.threads ?? videoThreads(), {
      hdr: probed.data.hdr,
      toneMap,
    })
    await runTool(ffmpeg, args, { timeoutMs: t.transcode ?? TRANSCODE_TIMEOUT_MS, maxStdoutBytes: 64 * 1024 })
  } catch (error) {
    if (error instanceof ToolError && error.reason === 'exit') throw new VideoRejectedError(VIDEO_REFUSALS.unreadable)
    throw error
  }

  // Verify what was actually encoded, not what the container claimed.
  const videoBytes = (await stat(videoFile)).size
  if (videoBytes >= OUTPUT_MAX_BYTES - 1024 * 1024) throw new VideoRejectedError(VIDEO_REFUSALS.unreadable)
  let outputJson: unknown
  try {
    const out = await runTool(ffprobe, buildOutputProbeArgs(videoFile), { timeoutMs: t.probe ?? PROBE_TIMEOUT_MS, maxStdoutBytes: 1024 * 1024 })
    outputJson = JSON.parse(out.toString('utf8'))
  } catch {
    throw new VideoRejectedError(VIDEO_REFUSALS.unreadable)
  }
  const output = checkOutput(outputJson, plan, probed.data.durationMs)
  if (!output.ok) throw new VideoRejectedError(output.error)

  const durationS = output.data.durationMs / 1000
  const png = await runTool(ffmpeg, buildPosterArgs(videoFile, Math.min(1, durationS / 3)), {
    timeoutMs: t.poster ?? POSTER_TIMEOUT_MS,
    maxStdoutBytes: 32 * 1024 * 1024,
  })
  if (png.length === 0) throw new VideoRejectedError(VIDEO_REFUSALS.unreadable)
  // Loaded on first use, like the photo pipeline.
  const { default: sharp } = await import('sharp')
  const poster = await sharp(png, { failOn: 'error' }).webp({ quality: POSTER_WEBP_QUALITY }).toBuffer()

  return {
    videoFile,
    videoHash: await sha256File(videoFile),
    videoBytes,
    poster,
    posterHash: createHash('sha256').update(poster).digest('hex').slice(0, 32),
    width: plan.width,
    height: plan.height,
    durationMs: output.data.durationMs,
    sourceContainer: container,
    hdr: probed.data.hdr,
    toneMap: probed.data.hdr ? toneMap : null,
  }
}

/** A fresh private temp folder; always remove it with removeWorkDir in a finally. */
export async function makeWorkDir(root = videoTempRoot()): Promise<string> {
  return mkdtemp(path.join(root, 'grace-video-'))
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
