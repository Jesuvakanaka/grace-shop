# syntax=docker/dockerfile:1
# ZP-463: single production image for Cloud Run.
#   - Web service (default CMD): Next.js standalone server (node server.js).
#   - Cloud Run Jobs reuse this image with a command override, e.g.
#       migrate: npm run migrate          (prisma migrate deploy)
#       seed:    npm run init             (node scripts/init-system.js)
#       other:   node scripts/<script>.js
#       import:  npm run import:august -- gs://<bucket>/<object> [--dry-run]
#       analytics rollup (ZP-493, nightly): npm run analytics:rollup [-- --date YYYY-MM-DD]
# Migrations are NOT applied at web start. No secrets are needed to build;
# DATABASE_URL / DIRECT_URL / JWT_SECRET are supplied at runtime.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- deps: install exact lockfile dependencies (dev deps included: the Prisma
# CLI is a devDependency and is needed at runtime by the migrate job) --------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --ignore-scripts: the root `postinstall: prisma generate` needs
# prisma/schema.prisma, which is not in this layer. Generation runs explicitly
# in the build stage instead.
RUN npm ci --ignore-scripts

# ---- build: prisma generate + next build (no database or secrets required) -
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generates the client and fetches the Linux query + schema engines into
# node_modules, so the non-root runtime never needs to download anything.
RUN npx prisma generate && npx prisma --version
RUN npm run build
# The SWC compiler binaries (~250 MB, gnu + musl) are only needed by
# `next build`; the standalone server and the job scripts never load them.
RUN rm -rf node_modules/@next/swc-*

# ---- runner -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# ZP-501: ffmpeg + ffprobe for product videos (src/lib/website/video-process.ts
# runs /usr/bin/ffmpeg and /usr/bin/ffprobe from PATH). Debian's package is
# used instead of the ffmpeg-static npm binaries: it gets distro security
# fixes on every rebuild (ffmpeg parses untrusted uploads), ships ffprobe, has
# libx264 and the zscale (libzimg) + tonemap filters used to turn iPhone HDR
# into SDR, and needs no install-time download. The build fails if any is
# missing. See docs/storefront/videos.md.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -hide_banner -encoders | grep -q libx264 \
  && ffmpeg -hide_banner -filters | grep -qw zscale \
  && ffmpeg -hide_banner -filters | grep -qw tonemap \
  && ffprobe -version > /dev/null

RUN groupadd --system --gid 1001 grace \
  && useradd --system --uid 1001 --gid grace --home-dir /app grace

# HOME / NPM_CONFIG_CACHE: /app is root-owned, so give npm/npx (used by the
# job overrides) a writable home for their cache and debug logs as non-root.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    HOME=/tmp \
    NPM_CONFIG_CACHE=/tmp/.npm

# Full node_modules from the build stage (Fieldstream pattern) so job
# overrides can use the Prisma CLI, @prisma/client, bcryptjs and xlsx.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
# Standalone server (server.js + traced files) on top; then the static assets
# and public/ that standalone does not copy by itself.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Job inputs: Prisma schema + migrations, node scripts, seed workbooks.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs/business-control-inputs ./docs/business-control-inputs
# ZP-468: `npm run import:august` is a tsx script (tsx is in the full
# node_modules above) that imports src/lib/** through the "@/" path alias in
# tsconfig.json, so both are needed at runtime. Read-only, root-owned.
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

# The Next.js server writes its image-optimisation (and ISR) cache to
# .next/cache at runtime; everything else stays root-owned and read-only.
RUN mkdir -p .next/cache && chown -R grace:grace .next/cache

USER grace

EXPOSE 8080

CMD ["node", "server.js"]
