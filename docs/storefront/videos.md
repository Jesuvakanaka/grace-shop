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
| `uploadId`, `uploadStartedAt` | processing lock: the upload being processed now (any instance) |
| `createdBy`, `createdAt`, `updatedAt` | |

A first upload is `PROCESSING` while it runs, then `READY` or `FAILED`.
A **replacement** keeps the current video `READY` (keys untouched) until the
new one is stored, so the public site never has a gap; if the replacement
fails, the old one stays exactly as it was.

**Processing lock (cross-instance).** Every processing run, first video or
replacement, first takes the lock atomically (`updateMany … where uploadId is
null or the lock is older than 10 minutes`, or `create` for a first row). A
second upload while a fresh lock is held gets **409** "A video for this
product is already being processed" and its chunks are kept so it can retry
(chunks are also kept on the per-instance **503** busy answer). The run
finishes with an update conditional on its own `uploadId`: if the video was
removed (row deleted) or the lock taken over meanwhile, nothing is written
back and the request answers 409 "removed or replaced while this one was
processing". A lock older than 10 minutes (instance stopped mid-way) is
stale: a first video then shows as failed, and a new upload takes the lock
over. The admin `GET` reports `processing: true` while a fresh lock is held,
so the panel shows "Processing" for replacements too.

Design note (deviation from the review wording): the review asked to set the
row to PROCESSING for replacements as well. The lock columns give the same
cross-instance 409 guard without taking the live public video offline
(public delivery only serves READY rows) for the length of the transcode.

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
   `-protocol_whitelist file` and `-max_pixels 8294400`: must be the same
   container, have a video stream, be at most **4K** (3840×2160 in either
   orientation; larger is refused with "too large (max 4K…)"), duration ≤ 30 s
   (+0.5 s container rounding). Rotation metadata (phones) is applied to get
   the display size; the HDR transfer (`color_transfer` `arib-std-b67` = HLG or
   `smpte2084` = PQ) is noted.
3. **ffmpeg**: same input options (`-max_pixels` bounds the decoder even if
   the stream changes resolution mid-way; the scale filter outputs a fixed
   size), first video stream only, `-an -sn -dn`, `-map_metadata -1
   -map_chapters -1`, scaled to fit **720×1280** (portrait/square) or
   **1280×720** (landscape), never upscaled, even sizes, at most 30 fps;
   `libx264 -profile:v high -pix_fmt yuv420p -preset veryfast -b:v 2M
   -maxrate 2500k -bufsize 4M`, BT.709 colour tags, `-movflags +faststart`,
   bitexact flags. **Hard output caps** whatever the container claims:
   `-t 30.5` and `-fs 41943040` (40 MB). 2 decoder/encoder threads
   (`GRACE_VIDEO_THREADS`), see memory below.
   - **HDR → SDR** (iPhone records HLG/PQ 10-bit by default): when ffmpeg has
     the `zscale` (libzimg) and `tonemap` filters (checked once with
     `ffmpeg -filters`; Debian bookworm's ffmpeg is built with
     `--enable-libzimg`, and the Dockerfile build fails without them):
     `scale, zscale=tin=<hlg|pq>:pin=bt2020:min=bt2020nc:t=linear:npl=100,
     format=gbrpf32le, zscale=p=bt709, tonemap=tonemap=hable:desat=0,
     zscale=t=bt709:m=bt709:p=bt709:r=tv, format=yuv420p`. Fallback without
     zscale: a BT.2020 → BT.709 matrix conversion in the scaler (flatter
     colours, still plays everywhere). Frames are then tagged BT.709
     (`setparams`), so players never treat the result as HDR.
4. **Verify the encoded file** with ffprobe: exactly one H.264 stream of the
   planned size, ≤ 30.5 s, below the `-fs` cap, and **not more than 1 s longer
   than the input claimed**. A WebM whose header says 10 s but which holds
   minutes is cut at 30.5 s by `-t` and refused here ("The video is longer
   than its file says (10 s)…").
5. **Poster**: one frame at min(1 s, ⅓ of the clip) as PNG on stdout →
   WebP (quality 80) with sharp.
6. Keys `videos/<sha256[:32]>.mp4` / `.webp`; stored with the existing image
   storage settings (below), then the row becomes `READY` (conditional on the
   processing lock) and the product's storefront tags are expired.

ffmpeg/ffprobe run via `child_process.spawn(bin, argsArray, { shell: false })`
with a SIGKILL timeout (probe 20 s, transcode 150 s, poster 20 s) and capped
stdout/stderr. Each job uses a private `mkdtemp` folder under
`GRACE_VIDEO_TMP_DIR` or `os.tmpdir()` (TEMP on Windows, `/tmp` on Cloud Run),
removed in a `finally`. One video is processed at a time per instance (a
second concurrent request gets 503 "try again in a minute"); the in-process
flag is set and cleared inside the same `try`/`finally`, so a database error
can never leave the instance stuck at 503.

### ffmpeg binaries: Debian `ffmpeg` in the image

The Cloud Run image installs Debian bookworm's `ffmpeg` package (runner stage
of the `Dockerfile`; the build fails if `libx264`, the `zscale` or `tonemap`
filter, or `ffprobe` is missing).
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
| 2 (default) | 12.6 s (17.0 s with the output check, machine ~50 % busy) | 7.5 MB, 720×1280 |
| 1 | 30.2 s (37.0 s, same) | 7.5 MB |

A 5 s 1080×1920 test clip takes ~2.5 s on an idle machine. Cloud Run's 1 vCPU is slower than a
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
  with `Content-Range: bytes a-b/size` and the exact `Content-Length`. A
  well-formed range that cannot be satisfied (starts at/after the end,
  `bytes=-0`, empty file) → **416** with `Content-Range: bytes */size`.
  Following RFC 9110 a Range header that is malformed, multi-range, has
  last < first, overflowing numbers or another unit is **ignored** → 200 with
  the whole file. `Accept-Ranges: bytes` always.
- **Conditional requests**: strong `ETag` = `"<32 hex>"` (the content hash in
  the key) and `Last-Modified` = the stored object's time (one metadata
  request; its size is passed on to the ranged read). `If-None-Match` (weak
  comparison, `*` allowed) → **304**; otherwise `If-Modified-Since` ≥
  Last-Modified → 304. `If-Range` keeps the range only for a strong ETag
  match or the exact Last-Modified date, else the whole file is sent. The
  published-only check runs first, so an unpublished video is 404 even with
  a matching ETag.
- Headers: `Content-Type: video/mp4` (or `image/webp` for posters), never from
  the stored object; `X-Content-Type-Options: nosniff`; `Content-Security-Policy:
  default-src 'none'; sandbox`.
- **Public cache (owner decision, same as photos)**: `PUBLIC_IMAGE_CACHE_CONTROL`
  from `src/lib/storefront/public-image.ts`, i.e. `public, max-age=300,
  s-maxage=300, stale-while-revalidate=60`. Browsers and shared caches stop
  reusing an unpublished video within about 5 minutes; revalidating an
  unchanged one is a cheap 304 thanks to the ETag. Private route:
  `private, max-age=86400`.
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
deletes (for chunks). `stat` is a single metadata request (GCS
`getMetadata`, 404 = missing) giving size and last change; `read` does no
existence check of its own.

## Public DTO

`PublicProduct.video: { src, poster, width, height } | null`
(`src/lib/storefront/dto.ts`). Only a `READY` video with valid keys and sizes;
`src`/`poster` are public route URLs. Status, keys, duration, size, error and
createdBy are never copied (`tests/video-dto.test.ts`). The owner preview
(`withPreviewImages`) points `src`/`poster` at the signed-in route. The field
is optional in the TypeScript type so hand-written DTOs need not list it;
`toPublicProduct` always sets it.

## Playback on the public site (ZP-502)

Pure rules in `src/lib/storefront/feed-media.ts` (tested in
`tests/storefront-feed-media.test.ts`); components in
`src/components/storefront/video/`.

- **Order** (`mediaItems`): the video is the **first** item of the feed
  slide's sideways strip and of the product page gallery, then the photos.
  Feed progress bars, gallery dots and thumbnails count it. A video without
  both URLs and a positive size is left out.
- **Element**: `<video muted loop playsInline preload poster>` (also
  `disablePictureInPicture`), accessible name "<name> – video".
- **Which one plays** (`useVideoPlayback`, `videoShouldPlay`): an
  IntersectionObserver on each `<video>` (threshold 0.6, viewport root). It
  measures the element clipped by its scrolling ancestors, so it covers both
  the vertical feed and a sideways strip / gallery: only the visible slide's
  visible strip item plays (at least 60% on screen); every other video is
  paused. The visitor's own play / pause (the button, or native controls)
  wins over autoplay until changed.
- **Preload** (`videoPreload`, feed): `auto` for the current slide's video
  (it is playing), `metadata` for the next slide only, `none` otherwise and
  always in the server HTML (autoplay is decided after hydration), so the
  first slide's poster stays the LCP.
- **Poster** is a real `<img>` underneath the video (`StorefrontImg`): eager
  with `fetchpriority="high"` on the first feed slide (and on the product
  page), shown without JavaScript, while loading and after a failure. The
  video fades in over it only once it actually plays (`playing` event).
- **No autoplay** with `prefers-reduced-motion: reduce` or
  `navigator.connection.saveData` (`autoplayAllowed`, `useAutoplayAllowed`):
  the feed shows the poster with a large play button; the product page shows
  the poster with native controls. If the browser refuses muted autoplay
  (`NotAllowedError`, e.g. iOS Low Power Mode) the play button shows too.
- **Failures**: a load error, or no playable data 8 s
  (`VIDEO_STALL_MS`) after asking to play / while buffering, marks the video
  failed: it stays hidden, the poster (and the photos after it) remain, and
  the feed's play button is removed.
- **Feed** (`FeedVideo`): the whole item is a link to the product page like
  the photos (in clean view it is the slide's way in, named like the first
  photo); a separate round play / pause button (44px, under the progress
  bars on the left; centred and larger when waiting for the visitor) is
  keyboard reachable.
- **Product page** (`GalleryVideo` in `Gallery.tsx`): the first gallery
  item, inline with native controls (keyboard play / pause, unmute is the
  visitor's choice), muted, plays while visible. It does not open the
  full-screen view; full screen shows the photos only (from the video it
  starts at photo 1). `ProductView` passes `product.video` to `Gallery`.

Local check data: create a product with a video through the admin API (see
above; set `GRACE_FFMPEG_PATH` / `GRACE_FFPROBE_PATH` in the gitignored
`.env` on Windows). UAT: `lime-pleated-midi-dress` has a test video.

## Revalidation

A successfully processed video and a removed one call
`revalidateStorefront({ productSlugs: [slug] })`: `storefront:products` and
`storefront:product:<slug>`.

## Tests

- `tests/video-validation.test.ts`: sniffing, limits, upload body/chunk index,
  key formats/traversal, ffprobe checks, transcode plan/arguments, Range parsing.
- `tests/video-dto.test.ts`: DTO allow-list, preview URLs.
- `tests/video-storage.test.ts`: GCS driver (one metadata request per stat,
  range passed through) with a fake client; local driver.
- `tests/video-delivery-db.test.ts`: published-only rule, Range/416/ignored
  ranges, cache policy, ETag/Last-Modified/304/If-Range, HEAD, private route
  auth, storefront host routing.
- `tests/video-admin-api.test.ts`: owner-only, id validation, refusals,
  busy flag released after a DB error, remove-while-processing not
  resurrected, cross-instance lock (409 keeps chunks, stale lock taken over);
  with real ffmpeg: end-to-end 1080×1920 → 720×1280 H.264 High yuv420p with
  no audio, no metadata and faststart, WebM/MOV, 32 s refused, a WebM lying
  about its duration refused, > 4K refused, HLG and PQ 10-bit tone-mapped to
  8-bit BT.709 (zscale and matrix paths), replacement failure keeps the old
  video, removal, revalidation.
