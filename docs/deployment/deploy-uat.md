# UAT deploy pipeline (ZP-470)

Every merge to `master` deploys Grace Shop to Cloud Run UAT through
`.github/workflows/deploy-uat.yml`. Pull requests run the same checks through
`.github/workflows/ci.yml`. Both call the shared `.github/workflows/checks.yml`,
so the PR gate and the pre-deploy gate are always identical.

GCP resources come from ZP-467:

| Item | Value |
| --- | --- |
| Project / region | `project-f4cd7300-6eb7-46cc-be3` / `africa-south1` |
| Auth | Workload Identity Federation, pool `grace-shop-uat`, provider `github`. No key files. |
| Deploy SA | `grace-shop-uat-deploy@…` (`run.admin` limited to resources named `grace-shop-*`, `cloudsql.viewer`) |
| Runtime SA | `grace-shop-uat-run@…` |
| Image | `africa-south1-docker.pkg.dev/project-f4cd7300-6eb7-46cc-be3/grace-shop-uat-docker/grace-shop` |
| Cloud SQL | `fieldstream-uat-db`, shared with Fieldstream, database `grace_shop` |
| Web service | `grace-shop-uat` |
| Jobs | `grace-shop-uat-migrate`, `grace-shop-uat-seed` |

Every Cloud Run service and job name must start with `grace-shop-`. The deploy
SA's IAM condition denies anything else.

## Pipeline steps

`deploy-uat` runs on a push to `master` and on manual dispatch. Deploys are
queued in one concurrency group and are never cancelled half-way.

1. **test**: `checks.yml`, the same job as PR CI. If it fails, nothing deploys.
   1. `npm ci`
   2. Lint: no new errors in changed files (see below).
   3. `npm run migrate` against a Postgres 16 service container.
   4. `npm test`, with a dummy test-only `JWT_SECRET`.
   5. `npm run build`
2. **deploy** (`needs: test`):
   1. `docker build`, tagged with `${GITHUB_SHA}`. The image is built before
      authenticating, so the auth action's credentials file is never in the
      build context.
   2. Authenticate through WIF and set up gcloud.
   3. `docker push`. Then resolve the digest and use `image@sha256:…` for every
      deploy below.
   4. Check that Cloud SQL `fieldstream-uat-db` is `RUNNABLE`. If it is not,
      the step fails with a clear message. The pipeline never starts or
      modifies the instance, because it belongs to Fieldstream.
   5. Deploy and execute (`--wait`) `grace-shop-uat-migrate`. It runs
      `npm run migrate` (`prisma migrate deploy`) with `DATABASE_URL` and
      `DIRECT_URL` from Secret Manager, 1 task and 0 retries. If the migration
      fails, the deploy stops and the running revision is untouched.
   6. Only when manually dispatched with `run_seed=true`: deploy and execute
      `grace-shop-uat-seed` (`npm run init`). See below.
   7. Deploy the `grace-shop-uat` web service:
      - Runtime SA, Cloud SQL attached.
      - Secrets: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, always `:latest`.
      - Env: `NODE_ENV=production`, `GRACE_IMAGE_STORAGE=gcs`,
        `GRACE_IMAGE_BUCKET=grace-shop-uat-images-266452509449`.
      - Port 8080, startup probe on `/api/health`.
      - `min-instances=0`, `max-instances=2`, 512Mi memory, 1 CPU, public.

      `--set-env-vars` and `--set-secrets` replace the whole set on every
      deploy, so a variable added by hand (for example `ALLOW_SETUP`) is
      removed by the next deploy. `ALLOW_SETUP` is never set on UAT.
   8. Smoke test. `GET /api/health` must return 200, and `GET /api/dashboard`
      without a cookie must return 401. The step prints the service URL and
      adds it to the run summary.

Secret values never appear in the workflow or its logs. Only the Secret
Manager names are referenced.

## Lint in CI: no new errors (temporary)

`npm run lint` currently fails on `master` with about 144 errors that were
already there. Until that backlog is fixed, CI runs
`.github/scripts/lint-no-new-errors.mjs <base>`, which enforces "no new lint
errors":

1. It lists the JS/TS files (`.ts`, `.tsx`, `.js`, `.mjs`) that the change
   adds, modifies or renames, relative to the merge base with `<base>`.
2. For each file it counts ESLint errors in the HEAD version, and in the base
   version (`git show <merge-base>:<file>`, linted with the same config under
   the same path).
3. It fails if any file's error count goes up. A new file must have 0 errors.
   Warnings are not counted. A per-file table (base, head, delta) is printed,
   with the errors of every failing file.

You can edit a file that has old errors without fixing them, as long as you
do not add more. Run it locally the same way:
`node .github/scripts/lint-no-new-errors.mjs origin/master`.

`<base>` is set as follows:

- In a pull request, `<base>` is `origin/<base branch>`.
- For a feature-branch push, it is `origin/master`.
- For a push to `master`, it is the previous `master` commit.
- A manual deploy dispatch skips this step, because `master` already passed it.

`scripts/**/*.js` and `prisma/**/*.js` are CommonJS Node scripts, so
`eslint.config.mjs` allows `require` there.

**TODO:** once `npm run lint` passes on `master`, replace the
"Lint (no new errors in changed files)" step in `checks.yml` with
`npm run lint`.

## One-time seed (users, products, opening stock)

`npm run init` re-applies the product data from the spreadsheets each time it
runs, so it would overwrite prices the owner changes later. For that reason
it **never** runs on a push. Run it once, after the first deploy has created
the schema:

1. GitHub → **Actions** → **deploy-uat** → **Run workflow**.
2. Branch `master`, tick **run_seed**, then **Run workflow**.

That run does the normal migrate step, then deploys and executes
`grace-shop-uat-seed` with `GRACE_OWNER_PASSWORD` and `GRACE_STAFF_PASSWORD`
from Secret Manager. Then it deploys the web service as usual.

## Where the owner reads the UAT passwords

Google Cloud console → **Security** → **Secret Manager** in project
`project-f4cd7300-6eb7-46cc-be3`:

- `grace-shop-uat-owner-password`: the OWNER sign-in password.
- `grace-shop-uat-staff-password`: the STAFF sign-in password.

Open the secret, then the `latest` version, then **View secret value**. Do not
paste the passwords into GitHub, Linear or chat.

## What never runs on UAT

The pipeline only ever calls `npm run migrate` (`prisma migrate deploy`).
These commands never run against UAT Cloud SQL, from the pipeline or by hand:

- `prisma db push`, `npm run db:push`
- `prisma db push --force-reset`
- `prisma migrate reset`, `npm run db:reset`
- `npm run init:fresh`

The `db-safety` guard refuses the npm scripts in production and against
Cloud SQL socket URLs as well. See `docs/deployment/migrations.md`.

## Rollback

Each deploy creates a new revision. To send all traffic back to an earlier
revision:

```bash
gcloud run revisions list --service=grace-shop-uat \
  --project=project-f4cd7300-6eb7-46cc-be3 --region=africa-south1

gcloud run services update-traffic grace-shop-uat \
  --to-revisions=<revision-name>=100 \
  --project=project-f4cd7300-6eb7-46cc-be3 --region=africa-south1
```

The next successful deploy sends 100% of traffic to the new revision again.

Rollback only changes the app code. Migrations are not reversed. If a
migration has to be undone, write a new forward migration and merge it.
Never reset the database.

## Failure guide

| Symptom | Meaning |
| --- | --- |
| `Cloud SQL instance fieldstream-uat-db is not RUNNABLE` | The shared instance is stopped. Ask the owner to start it, then re-run. The pipeline does not start it. |
| Migrate job execution failed | The migration failed and the web service was not deployed. Read the job's execution logs in the Cloud Run console. |
| `PERMISSION_DENIED` on a Cloud Run resource | The resource name does not start with `grace-shop-`, or the deploy SA's IAM condition needs extending (see the ZP-467 resource record). |
| Smoke test: `/api/dashboard` not 401 | The dashboard API is reachable without auth. Treat it as a release blocker. |
