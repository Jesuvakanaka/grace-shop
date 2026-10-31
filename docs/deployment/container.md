# Production container (ZP-463)

One image serves the Cloud Run web service and the Cloud Run Jobs.

| Use | Command |
| --- | --- |
| Web service (default `CMD`) | `node server.js` (Next.js standalone server, listens on `$PORT`, default 8080, bound to `0.0.0.0`) |
| Migrate job | `npm run migrate` (`prisma migrate deploy`) |
| Seed / init job | `npm run init` (`node scripts/init-system.js`) |
| Other jobs | `node scripts/<script>.js` |

Migrations are never applied when the web service starts.

## Runtime environment

- `DATABASE_URL` and `DIRECT_URL` are both required, because `schema.prisma` uses `directUrl`.
- `JWT_SECRET` is required in production.
- `NODE_ENV=production`, `PORT=8080` and `HOSTNAME=0.0.0.0` are already set in the image.

`next build` needs no database and no secrets, so none are passed at build time.

## Health check

`GET /api/health` returns `200 {"status":"ok"}` with `Cache-Control: no-store`. It needs no auth and does not touch the database. Use it for the Cloud Run startup and liveness probes.

## Image layout and size

- Stages: `deps` (`npm ci --ignore-scripts`), `build` (`prisma generate`, then `next build`), and `runner` (uid 1001 `grace`, non-root).
- `npm ci` uses `--ignore-scripts` because the `postinstall: prisma generate` step needs `prisma/schema.prisma`, which the deps layer does not have. `prisma generate` runs explicitly in the build stage instead. That step also puts the Linux query and schema engines into `node_modules`, so the non-root runtime never downloads anything.
- The runner keeps the build stage's full `node_modules`, the same pattern Fieldstream uses. The standalone output is copied on top of it. The full set is kept so the job overrides have the Prisma CLI (a devDependency), `@prisma/client`, `bcryptjs` and `xlsx`. The only thing removed is the SWC compiler binaries (`@next/swc-*`, about 250 MB), which only `next build` uses.
- Size, measured locally: about 1.43 GB on disk and 318 MB compressed content. The runner's `node_modules` is the bulk of it.

## `.dockerignore` and docs spreadsheets

The issue asked to exclude `docs/**/*.xlsx`. That rule was aimed at the large untracked `docs/august-trip/` workbook. `npm run init` reads `docs/business-control-inputs/*.xlsx` at runtime, so the image needs those files. The ignore file therefore:

- excludes `docs/august-trip/` and every other `docs/**/*.xlsx`;
- re-includes `docs/business-control-inputs/*.xlsx`.

`.env*` files are never sent to the build context.

## Local run

```bash
docker build -t grace-shop:local .
docker run --rm -p 3463:8080 \
  -e DATABASE_URL=postgresql://grace:grace_local_dev@host.docker.internal:5433/<db> \
  -e DIRECT_URL=postgresql://grace:grace_local_dev@host.docker.internal:5433/<db> \
  -e JWT_SECRET=<random> grace-shop:local
```

In production the `auth-token` cookie is `Secure`, so browsers only send it back over HTTPS. Over plain `http://localhost`, send it manually as a `Cookie:` header when testing with curl.
