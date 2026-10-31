# Database migrations

Grace Shop uses versioned Prisma migrations in `prisma/migrations/`. Shared
databases (UAT and production Cloud SQL) are changed only by applying these
migrations with `npm run migrate` (`prisma migrate deploy`).

`prisma/migrations/0_init` is the baseline. It creates the schema as it was
when the app still used `prisma db push`.

## Never run against Cloud SQL

These commands drop data or change the schema without a reviewed migration:

| Command | What it does |
| --- | --- |
| `prisma db push` / `npm run db:push` | Syncs the schema with no migration history. It can drop columns. |
| `prisma db push --force-reset` | Drops every table. |
| `prisma migrate reset` / `npm run db:reset` | Drops the database and re-applies migrations. |
| `prisma migrate dev` | Can reset the database when it finds drift. |
| `npm run init:fresh` | Runs `prisma migrate reset` and then seeds. |

`npm run db:push`, `npm run db:reset` and `npm run init:fresh` go through
`scripts/lib/db-safety.js`. The guard refuses to run, before it connects,
in any of these cases:

- `NODE_ENV=production`.
- It is running inside Cloud Run (`K_SERVICE` or `CLOUD_RUN_JOB` is set).
- `DATABASE_URL` or `DIRECT_URL` points at a host other than `localhost`,
  `127.0.0.1` or `::1`.
- The URL has a `?host=` (socket) parameter, as Cloud SQL socket URLs do.

The guard is a backstop, not a permission. Calling `npx prisma ...` directly
bypasses it. Deploy pipelines must only ever call `npm run migrate`.

## Creating a new migration

Work against your own local database, for example the Docker Postgres on
port 5433. See `docker-compose.yml`.

```bash
export DATABASE_URL=postgresql://grace:grace_local_dev@localhost:5433/grace_shop_<you>
export DIRECT_URL=$DATABASE_URL

npm run migrate                                     # bring the local DB up to date first
# edit prisma/schema.prisma
npx prisma migrate dev --create-only --name <short_description>
# review prisma/migrations/<timestamp>_<short_description>/migration.sql
npm run migrate                                     # apply it locally
npx prisma migrate status                           # "Database schema is up to date!"
```

Commit the new migration folder together with the `schema.prisma` change.
Never edit a migration that has already been applied to a shared database.
Add a new migration instead.

Use `--create-only` so you can review the SQL before it runs, for example to
add a data backfill or make a destructive rename safe.

## How deploys apply migrations

Deploys run migrations as a separate step, before the new app revision gets
traffic. The step is the Cloud Run job `grace-shop-uat-migrate`, which uses
the same image as the app and runs this command:

```bash
npm run migrate        # = prisma migrate deploy
```

`prisma migrate deploy` only applies migrations that are not yet recorded
in `_prisma_migrations`. It never resets the database or generates new SQL.
It is safe to re-run, and it does nothing when there is nothing pending. If
a migration fails, the job fails and the deploy must stop.

To check a database without changing it:

```bash
npx prisma migrate status
```

## Baselining an existing database

A database created with `prisma db push`, such as data migrated from
Supabase, already has the tables but no `_prisma_migrations` history.
Running `npm run migrate` on it would try to create the tables again and
fail. Mark the baseline as already applied instead. This does not touch any
data.

1. Back up the database first (Cloud SQL backup or `pg_dump`).
2. Point `DATABASE_URL` and `DIRECT_URL` at the database. Then check that
   its schema matches `0_init` exactly:

   ```bash
   npx prisma migrate diff \
     --from-url "$DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma \
     --exit-code
   ```

   Exit code `0` and "No difference detected." mean you can continue. Exit
   code `2` means there is drift, and the diff shows SQL. Stop and resolve
   the drift in a reviewed migration. Do not baseline over drift.

   Run this check against the `schema.prisma` of the commit that contains
   only `0_init`. Once later migrations exist, a database that only has the
   baseline will (correctly) show those later changes as a difference.

3. Record the baseline without running it:

   ```bash
   npx prisma migrate resolve --applied 0_init
   ```

4. Apply any later migrations and confirm:

   ```bash
   npm run migrate
   npx prisma migrate status    # "Database schema is up to date!"
   ```

Compare row counts per table before step 3 and after step 4. They must be
identical. This procedure was tested on the local Docker database: a
db-push database seeded by `npm run init` (48 products, 48 stock movements,
2 users, 1 exchange rate) was baselined with unchanged row counts.

## Local development

| Task | Command |
| --- | --- |
| Create or update tables | `npm run migrate` |
| Seed users, products and opening stock | `npm run init` |
| Wipe a local DB and start again | `npm run init:fresh` (local only; guarded) |
| Wipe without seeding | `npm run db:reset` (local only; guarded) |
