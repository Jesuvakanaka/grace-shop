# syntax=docker/dockerfile:1
# ZP-463: single production image for Cloud Run.
#   - Web service (default CMD): Next.js standalone server (node server.js).
#   - Cloud Run Jobs reuse this image with a command override, e.g.
#       migrate: npm run migrate          (prisma migrate deploy)
#       seed:    npm run init             (node scripts/init-system.js)
#       other:   node scripts/<script>.js
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

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 grace \
  && useradd --system --uid 1001 --gid grace --home-dir /app grace

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Full node_modules from the build stage (Fieldstream pattern) so job
# overrides can use the Prisma CLI, @prisma/client, bcryptjs and xlsx.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
# Standalone server (server.js + traced files) on top; then the static assets
# and public/ that standalone does not copy by itself.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Job inputs: Prisma schema (+ future migrations), node scripts, seed workbooks.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs/business-control-inputs ./docs/business-control-inputs

USER grace

EXPOSE 8080

CMD ["node", "server.js"]
