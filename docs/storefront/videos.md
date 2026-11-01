# Product videos (ZP-501)

One optional video per product, uploaded by the OWNER in the product's
**Website** panel, processed on the server into a small, silent MP4 and served
to the public site only while the product is public. Photos are unchanged:
a product still needs a photo to be published; the video is extra.

## What the owner sees

Website panel, under Photos: **Video (optional)**.

- **Add video / Replace video**: MP4, MOV or WebM, up to **60 MB** and
  **30 seconds**. A progress bar shows the upload, then "Processing the video…"
  (a few seconds; up to about a minute for a long, detailed clip on UAT).
- When ready: a preview player (plays from the signed-in route, so it works
  before publishing), and "5 s · 720×1280 · 0.8 MB".
- **Remove** deletes it from the product (asks first).
- Refusals are shown in plain words, e.g. "The video is too large (max 60 MB).",
  "That file is not a supported video. Use an MP4, MOV or WebM video.",
  "The video is 42 s long; the limit is 30 s. Trim it and try again.",
  "That file has no video picture in it (only sound?)."
- Sound and metadata (location, camera, titles) are always removed.

## Data model

`ProductVideo` (migration `20261102090000_product_video`), at most one per
product (`productId` unique, cascade delete):

| column | meaning |
|---|---|
| `status` | `PROCESSING` / `READY` / `FAILED` |
| `videoKey`, `posterKey` | `videos/<32 hex>.mp4`, `videos/<32 hex>.webp` (content-hashed) |
| `width`, `height`, `durationMs`, `sizeBytes` | of the processed MP4 |
| `error` | owner-facing reason when `FAILED` |
| `createdBy`, `createdAt`, `updatedAt` | |

A first upload is `PROCESSING` while it runs, then `READY` or `FAILED`.
A **replacement** leaves the current `READY` video live until the new one is
stored (no gap on the public site); if the replacement fails, the old one
stays. A `PROCESSING` row older than 10 minutes (instance stopped mid-way) is
shown as failed and a new upload is allowed.

## Upload flow (chunked)

```
POST /api/website/products/:id/video/uploads        { size }  -> { token, chunkSize, chunks, expiresAt }
PUT  /api/website/products/:id/video/chunks/:index  raw bytes, header X-Upload-Token
POST /api/website/products/:id/video                { token } -> { video }   (processes)
GET  /api/website/products/:id/video                          -> { video | null }
DELETE /api/website/products/:id/video                        -> { video: null }
```

All OWNER only (`authorize(OWNER_ONLY)`), `:id` validated with `parseIdParam`.

**Why chunks.** Two hard limits would silently break a single 60 MB request:
the Next proxy (`src/proxy.ts` matches `/api/**`) buffers at most **10 MB** of
a request body and *truncates* the rest (`proxyClientMaxBodySize`), and Cloud
Run refuses HTTP/1 requests above **32 MiB**. Chunks are 8 MiB. Because
chunks may land on different Cloud Run instances, they are stored in the
video storage (`videos/uploads/<uploadId>/<n>.part`) and the upload's identity
(`productId`, random `uploadId`, `size`, owner `username`) travels in a signed,
1-hour token (`src/lib/website/video-upload-token.ts`, session secret,
`purpose: 'video-upload'`), not in server memory.

Each chunk is read with a hard byte cap (an oversized `Content-Length` is
refused before reading; the stream is cut off past the expected size, 413);
nothing is ever buffered beyond one 8 MiB chunk. Chunk 0 is sniffed at once,
so a non-video is refused before the rest is sent. The process step
re-checks every chunk's size, concatenates them into a temp file with a total
cap, and deletes the chunks afterwards (success or not).

**Abandoned uploads** (owner closes the tab mid-upload) leave chunk objects
under `videos/uploads/`. Recommended (infra, not applied by this change): a GCS
lifecycle rule on the images bucket deleting objects with prefix
`videos/uploads/` older than 1 day.

## Processing (`src/lib/website/video-process.ts`)

1. **Sniff** the container from the first bytes (`sniffVideoContainer`):
   ISO-BMFF `ftyp` with an MP4 brand → mp4, `qt  ` → mov (HEIC/AVIF brands
   refused), EBML with DocType `webm` → webm (other Matroska refused). The
   client's file name and MIME type are never used.
2. **ffprobe**, forced to that demuxer (`-f mov` / `-f matroska`) with
   `-protocol_whitelist file`: must be the same container, have a video stream,
   frames ≤ 8192 px, duration ≤ 30 s (+0.5 s container rounding). Rotation
   metadata (phones) is applied to get the display size.
3. **ffmpeg**: first video stream only, `-an -sn -dn`, `-map_metadata -1
   -map_chapters -1`, scaled to fit **720×1280** (portrait/square) or
   **1280×720** (landscape), never upscaled, even sizes, at most 30 fps;
   `libx264 -profile:v high -pix_fmt yuv420p -preset veryfast -b:v 2M
   -maxrate 2500k -bufsize 4M`, `-movflags +faststart`, bitexact flags.
   2 decoder/encoder threads (`GRACE_VIDEO_THREADS`), see memory below.
4. **Poster**: one frame at min(1 s, ⅓ of the clip) as PNG on stdout →
   WebP (quality 80) with sharp.
5. Keys `videos/<sha256[:32]>.mp4` / `.webp`; stored with the existing image
   storage settings (below), then the row becomes `READY` and the product's
   storefront tags are expired.

ffmpeg/ffprobe run via `child_process.spawn(bin, argsArray, { shell: false })`
with a SIGKILL timeout (probe 20 s, transcode 150 s, poster 20 s) and capped
stdout/stderr. Each job uses a private `mkdtemp` folder under
`GRACE_VIDEO_TMP_DIR` or `os.tmpdir()` (TEMP on Windows, `/tmp` on Cloud Run),
removed in a `finally`. One video is processed at a time per instance (a
second concurrent request gets 503 "try again in a minute").

### ffmpeg binaries: Debian `ffmpeg` in the image

The Cloud Run image installs Debian bookworm's `ffmpeg` package (runner stage
of the `Dockerfile`; the build fails if `libx264` or `ffprobe` is missing).
Chosen over the `ffmpeg-static` / `ffprobe-static` npm packages because:

- ffmpeg parses untrusted uploads; the distro package gets security fixes on
  every image rebuild, the static npm builds are pinned old releases
  (`ffprobe-static` ships ffprobe 4.x and is ~350 MB unpacked for all platforms);
- `ffmpeg-static` downloads its binary from GitHub in an install script, which
  `npm ci --ignore-scripts` (Dockerfile) and npm 11's install-script approval
  both skip, and it has no ffprobe;
- one package gives both binaries with libx264.

Binaries are resolved from `GRACE_FFMPEG_PATH` / `GRACE_FFPROBE_PATH`, else
`ffmpeg` / `ffprobe` on `PATH` (`/usr/bin` in the image).

**Windows development:** `winget install Gyan.FFmpeg.Essentials` (adds both to
PATH for new shells), or set the two variables in your gitignored `.env`, e.g.
`GRACE_FFMPEG_PATH=C:/…/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe`.
`tests/video-admin-api.test.ts` uses the real binaries and skips its ffmpeg
tests when they are not found.

### Timing and memory (synchronous processing is fine for v1)

Measured locally (Windows, ffmpeg 9.0.1) on a deliberately hard worst case: a
**30 s, 1080×1920, 30 fps, 50 MB** clip of animated noise (`testsrc2` + noise):

| threads | probe + transcode + poster | output |
|---|---|---|
| 2 (default) | 12.6 s | 7.5 MB, 720×1280 |
| 1 | 30.2 s | 7.5 MB |

A 5 s 1080×1920 test clip takes ~2.5 s. Cloud Run's 1 vCPU is slower than a
desktop core; even at 2× slower the worst case is ~60 s, well inside the
service's 300 s request timeout, so v1 processes in the request (route
`maxDuration = 300`). Real phone clips compress far better than noise.

Peak ffmpeg memory: ~110 MB (1 thread), ~140 MB (2 threads), but 466 MB with
ffmpeg's automatic threads on an 18-core machine; hence the explicit thread
count. On Cloud Run `/tmp` is in memory: the assembled upload (≤ 60 MB) plus
the output (≤ ~8 MB) count against the instance. The UAT web service memory
was raised from 512 MiB to **1 GiB** (`.github/workflows/deploy-uat.yml`).

If clips get longer or uploads more frequent, move processing to a Cloud Run
Job (same image, command override) triggered by the process call, with the
row staying `PROCESSING` until the job finishes and the panel polling
`GET …/video`.

## Delivery (`src/lib/website/video-delivery.ts`)

| route | who | serves |
|---|---|---|
| `GET/HEAD /api/videos/public/<32 hex>.mp4\|.webp` | anyone | only the video/poster of a `READY` video of a **public** product (published, slug, published category: `PUBLIC_PRODUCT_WHERE`), checked on every request |
| `GET/HEAD /api/videos/<32 hex>.mp4\|.webp` | signed in (`ANY_ROLE`, like photos) | any stored video/poster (owner preview, preview links) |

- Anything else on the public route (bad name, unknown key, unpublished,
  not READY, bytes missing) is the same plain **404** (`Cache-Control: no-store`).
- **HTTP Range**: one byte range (`bytes=a-b`, `bytes=a-`, `bytes=-n`) → **206**
  with `Content-Range: bytes a-b/size` and the exact `Content-Length`;
  unsatisfiable or malformed byte ranges (and multi-range) → **416** with
  `Content-Range: bytes */size`; another unit is ignored (200). `Accept-Ranges:
  bytes` always.
- Headers: `Content-Type: video/mp4` (or `image/webp` for posters), never from
  the stored object; `X-Content-Type-Options: nosniff`; `Content-Security-Policy:
  default-src 'none'; sandbox`.
- Public cache: `public, max-age=31536000, immutable` (keys are content-hashed,
  a new video has a new URL). Trade-off: a browser or CDN that already fetched a
  video may keep it after the product is unpublished; the origin returns 404 at
  once and the storefront stops linking it. Photos keep their 5-minute cache.
- The storefront host (`GRACE_STOREFRONT_HOSTS`) lets `/api/videos/public/`
  through (`src/lib/host-routing.ts`); `/api/videos/<key>` is 404 there.
- Keys accepted anywhere: `videos/<32 hex>.mp4`, `videos/<32 hex>.webp`,
  `videos/uploads/<32 hex>/<0-7>.part` (`src/lib/storage/video-keys.ts`); the
  local driver also checks the resolved path stays inside its root.
- Removed or replaced videos' objects stay in storage (keys may be shared by
  identical uploads, as with photos); they are no longer served publicly.

## Storage

`src/lib/storage/videos.ts` (`getVideoStorage`) uses the image settings:
`GRACE_IMAGE_STORAGE=gcs` + `GRACE_IMAGE_BUCKET` on UAT (private bucket,
runtime service account, objects under `videos/`), local files under
`GRACE_IMAGE_DIR` (default `.data/uploads/videos/`) in development. Unlike
the image driver it supports byte-range reads, streamed file uploads and
deletes (for chunks).

## Public DTO

`PublicProduct.video: { src, poster, width, height } | null`
(`src/lib/storefront/dto.ts`). Only a `READY` video with valid keys and sizes;
`src`/`poster` are public route URLs. Status, keys, duration, size, error and
createdBy are never copied (`tests/video-dto.test.ts`). The owner preview
(`withPreviewImages`) points `src`/`poster` at the signed-in route. The field
is optional in the TypeScript type so hand-written DTOs need not list it;
`toPublicProduct` always sets it.

## Revalidation

A successfully processed video and a removed one call
`revalidateStorefront({ productSlugs: [slug] })`: `storefront:products` and
`storefront:product:<slug>`.

## Tests

- `tests/video-validation.test.ts`: sniffing, limits, upload body/chunk index,
  key formats/traversal, ffprobe checks, transcode plan/arguments, Range parsing.
- `tests/video-dto.test.ts`: DTO allow-list, preview URLs.
- `tests/video-delivery-db.test.ts`: published-only rule, Range/416, headers,
  HEAD, private route auth, storefront host routing.
- `tests/video-admin-api.test.ts` (real ffmpeg): owner-only, id validation,
  refusals, end-to-end 1080×1920 → 720×1280 H.264 High yuv420p with no audio,
  no metadata and faststart, WebM/MOV, 32 s refused, replacement failure keeps
  the old video, removal, revalidation.
