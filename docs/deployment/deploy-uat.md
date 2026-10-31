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
queued in one concurrency group and are never cancelled half-way. Only
`master` deploys: a manual run from any other branch runs the **test** job
and skips **deploy**.

1. **test**: `checks.yml`, the same job as PR CI. If it fails, nothing deploys.
   1. `npm ci`
   2. Lint: no new errors in changed files (see below).
   3. `npm run migrate` against a Postgres 16 service container.
   4. `npm test`, with a dummy test-only `JWT_SECRET`.
   5. `npm run build`
2. **deploy** (`needs: test`, only on `refs/heads/master`):
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
   7. Deploy the `grace-shop-uat` web service, candidate first:
      - If the service already exists, the new revision is deployed with
        `--no-traffic --tag=candidate`. Users stay on the current revision.
      - On the very first deploy the service does not exist yet, and
        `--no-traffic` is rejected for a new service, so it is a normal
        deploy that takes traffic directly.

      Settings on every deploy:
      - Runtime SA, Cloud SQL attached.
      - Secrets: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, always `:latest`.
      - Env: `NODE_ENV=production`, `GRACE_IMAGE_STORAGE=gcs`,
        `GRACE_IMAGE_BUCKET=grace-shop-uat-images-266452509449`,
        `GRACE_QUICK_LOGIN` (repository variable, default `false`; see
        [UAT quick sign-in](#uat-quick-sign-in)),
        `GRACE_STOREFRONT_HOSTS` and `GRACE_ADMIN_HOSTS` (repository
        variables, default empty; see
        [Storefront and admin hosts](#storefront-and-admin-hosts-two-front-doors)).
        The list is passed with gcloud's `^@^` delimiter so the commas inside
        a host list survive.
      - Port 8080, startup probe on `/api/health`.
      - `min-instances=0`, `max-instances=2`, 512Mi memory, 1 CPU, public.

      `--set-env-vars` and `--set-secrets` replace the whole set on every
      deploy, so a variable added by hand (for example `ALLOW_SETUP`) is
      removed by the next deploy. `ALLOW_SETUP` is never set on UAT.
   8. Smoke-test the candidate on its tag URL
      (`https://candidate---grace-shop-uat-….run.app`), using
      `.github/scripts/smoke-test.sh`. `GET /api/health` must return 200, and
      `GET /api/dashboard` without a cookie must return 401. If it fails, the
      deploy stops and users never see the new revision.
   9. Promote: `gcloud run services update-traffic grace-shop-uat --to-latest`.
      This also removes any traffic pin left by a manual rollback.
   10. Check that 100% of traffic is on the latest revision. Then run the same
       smoke test against the main service URL. The step prints the URL and
       revision and adds them to the run summary.

Secret values never appear in the workflow or its logs. Only the Secret
Manager names are referenced.

## Lint in CI: no new errors (temporary)

`npm run lint` currently fails on `master` with about 144 errors that were
already there. Until that backlog is fixed, CI runs
`.github/scripts/lint-no-new-errors.mjs <base>`, which enforces "no new lint
errors":

1. It lists the JS/TS files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
   `.mjs`, `.cjs`) that the change adds, modifies or renames, relative to the
   merge base with `<base>`.
2. For each file it counts ESLint errors in the HEAD version, and in the base
   version (`git show <merge-base>:<file>`, linted with the same config under
   the same path).
3. It fails if any file's error count goes up. A new file must have 0 errors.
   Warnings are not counted. A per-file table (base, head, delta) is printed,
   with the errors of every failing file.
4. If an `eslint.config.*` file changed, it also lints every tracked JS/TS
   file twice: at HEAD with the HEAD config, and at the merge base with the
   base config. It fails if the total error count goes up, because a config
   change can add errors to files the change never touched.

Known gap: an ESLint plugin or version bump in `package-lock.json`, without a
config change, is not compared across the whole tree. Both sides use HEAD's
`node_modules`, so it only shows up in the changed files.

You can edit a file that has old errors without fixing them, as long as you
do not add more. Run it locally the same way:
`node .github/scripts/lint-no-new-errors.mjs origin/master`.

`<base>` is set as follows:

- In a pull request (`ci`), `<base>` is `origin/<base branch>`.
- For a manual `ci` run, it is `origin/master`.
- For a push to `master` (`deploy-uat`), it is the previous `master` commit
  (`github.event.before`).
- For a manual `deploy-uat` run, it is `HEAD^`, the last commit, so the gate
  never skips silently.
- If the given base is not in the history (for example after a force push),
  the script falls back to `origin/master`, or to `HEAD^` when
  `origin/master` is HEAD itself.

`ci` runs on `pull_request` and `workflow_dispatch` only. There is no `push`
trigger, so a PR branch is not checked twice. Until a PR is opened, run `ci`
by hand from the Actions tab, or run the commands locally.

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

The seed job also sets `GRACE_OWNER_USERNAME=margie` and
`GRACE_OWNER_FULLNAME=Margaret`, so a fresh seed creates the owner as
`margie` ("Margaret"). Locally both default to `owner` / `Business Owner`.
The seed only creates a missing user: on a database that already has the old
`owner` user, rename it first (below), or the seed adds a second OWNER called
`margie`.

### Renaming the owner (`owner` → `margie`)

`scripts/set-user.js` renames a user and/or sets the full name. It never
touches passwords and never prints secrets:

```bash
npm run user:set -- --from owner --to margie --full-name "Margaret"
```

It is idempotent: if only `margie` exists (already renamed) it only updates
the full name, when `--full-name` is given and differs, and exits 0. If both
`owner` and `margie` exist as different users it changes nothing and exits 1,
naming both users and their ids ("Both 'owner' (id 1) and 'margie' (id 3)
exist; resolve manually"). If neither exists it exits 1. `--full-name` with no
value is rejected. The password stays the same (the
`grace-shop-uat-owner-password` value, unless it was changed in the app).
On UAT it has to run where `DATABASE_URL` points at Cloud SQL, for example as a
one-off Cloud Run job from the deployed image (`--command=npm
--args=run,user:set,--,--from,owner,--to,margie,--full-name,Margaret`, with the
same service account, Cloud SQL attachment and `DB_SECRETS` as the migrate
job, and a name starting with `grace-shop-`).

## UAT quick sign-in

**What it does.** When `GRACE_QUICK_LOGIN=true` is set on the web service, the
login page shows a "UAT quick sign-in" section with one button per role, for
example "Margaret — Owner" and "Shop Staff — Staff", plus an amber
"UAT only" note. A button signs in straight away as the first **active** user
of that role (lowest id), without a password. It sets the same session cookie
as the normal sign-in (`HttpOnly`, `Secure`, `SameSite=lax`, 24 hours). The
username/password form stays underneath. Every quick sign-in is logged as
`[quick-login] <ROLE> <username>` in the Cloud Run logs.

API: `GET /api/auth/quick-login` returns `{ enabled, setupAllowed, users? }`
(role, username and full name only). `POST /api/auth/quick-login` with
`{"role":"OWNER"|"STAFF"}` signs in. With the flag off, `GET` returns
`{"enabled":false,...}` and `POST` returns 404 before reading the body or the
database.

**Risk.** Anyone who has the UAT URL can sign in as the owner and see or
change every record. The owner accepted this for UAT on 2026-10-31 because
UAT holds test data only (see `docs/security/zp-465-security-review.md`,
section 6). It **must be OFF before any real data is entered and before
go-live.**

**Default.** Off everywhere. The app only enables it when the value is exactly
the string `true`. The workflow passes the GitHub repository variable
`GRACE_QUICK_LOGIN` and uses `false` when the variable is not set.

**Turn it ON or OFF.**

```bash
# ON
gh variable set GRACE_QUICK_LOGIN --body true -R Jesuvakanaka/grace-shop
# OFF
gh variable set GRACE_QUICK_LOGIN --body false -R Jesuvakanaka/grace-shop
```

Changing the variable does nothing until the next deploy. Then either re-run
**deploy-uat** (Actions → deploy-uat → Run workflow, branch `master`, leave
`run_seed` unticked), or merge to `master`. Check the login page afterwards:
the quick sign-in section must appear (ON) or be gone (OFF), and with OFF
`POST /api/auth/quick-login` returns 404.

The smoke test is unaffected: `GET /api/dashboard` without a cookie is still
401 either way.

The "First time? Set up admin account" link is also hidden on UAT now, because
first-time setup is disabled in production unless `ALLOW_SETUP=true`.

## Storefront and admin hosts (two front doors)

One web service serves two sites (ZP-485):

- **Back office (admin).** Every admin page, the login screen and all of
  `/api/*`. This is what UAT serves today.
- **VYRA storefront.** The public site. Its pages live in `src/app/site/**`.

`src/proxy.ts` picks the site from the request's `Host` header, using two
repository variables. Each is a comma-separated list of hostnames, without
`https://`. Case and port are ignored, and `www.` + a listed host matches too.

| Variable | Example | Default |
| --- | --- | --- |
| `GRACE_STOREFRONT_HOSTS` | `vyra.co.zw` | empty |
| `GRACE_ADMIN_HOSTS` | `admin.vyra.co.zw` | empty |

**Default (both empty): nothing changes.** Every host behaves as the back
office, exactly as before. The storefront is still reachable for preview at
`/site` on the UAT URL, for example `https://grace-shop-uat-….run.app/site`.

**On a storefront host:**

- `/` serves the storefront home (`/site`) and `/shop` serves `/site/shop`.
  The address bar keeps the clean path.
- `/site/...` redirects (308) to the clean path. `/site/` takes two hops:
  Next.js first strips the trailing slash (308 to `/site`), then the proxy
  sends `/site` to `/`.
- `/_next/*`, `/brand/*`, top-level public files (favicon, icons, manifest,
  `robots.txt`, `sitemap.xml`), `/api/public/*` and `/api/images/public/*`
  pass through.
- Every other `/api/*` (including `/api/auth/*`, `/api/auth/quick-login` and
  `/api/health`) and every admin page (`/products`, `/settings/...`, ...) is a
  plain **404**. There is no redirect to the back office.

**On any other host** (a listed admin host, the `*.run.app` service and tag
URLs, the startup probe): back office, unchanged. An unlisted host falls back
to the back office, so the run.app URL and `/api/health` keep working. A host
listed in both variables is treated as storefront. Today `GRACE_ADMIN_HOSTS`
documents the admin domain; the routing only acts on the storefront list.

**Search engines.** Every back-office response, and `/site` previewed from the
admin host, carries `X-Robots-Tag: noindex, nofollow`. Storefront pages carry
`<meta name="robots" content="noindex, nofollow">` until launch.

**Session cookie.** `auth-token` is host-only (no `Domain` attribute), so a
back-office sign-in is never sent to the storefront host
(`tests/session-cookie-host-only.test.ts`).

**Set the hosts** (only once the domain is mapped to `grace-shop-uat`):

```bash
gh variable set GRACE_STOREFRONT_HOSTS --body "vyra.co.zw" -R Jesuvakanaka/grace-shop
gh variable set GRACE_ADMIN_HOSTS --body "admin.vyra.co.zw" -R Jesuvakanaka/grace-shop
# Back to "admin everywhere"
gh variable delete GRACE_STOREFRONT_HOSTS -R Jesuvakanaka/grace-shop
```

As with `GRACE_QUICK_LOGIN`, a change takes effect on the next deploy. The
deploy step rejects a value with anything other than hostname characters,
commas, colons and spaces.

**Check after a deploy**, with the storefront host set:

```bash
curl -sI https://<storefront-host>/                  # 200, storefront
curl -sI https://<storefront-host>/products          # 404
curl -sI https://<storefront-host>/api/auth/session  # 404
curl -sI https://<storefront-host>/site              # 308, location: /
curl -sI https://<admin-host>/                       # 200, x-robots-tag: noindex, nofollow
```

## Where the owner reads the UAT passwords

Google Cloud console → **Security** → **Secret Manager** in project
`project-f4cd7300-6eb7-46cc-be3`:

- `grace-shop-uat-owner-password`: the OWNER sign-in password.
- `grace-shop-uat-staff-password`: the STAFF sign-in password.

Open the secret, then the `latest` version, then **View secret value**. Do not
paste the passwords into GitHub, Linear or chat.

These values are only the **initial** passwords. The seed creates a user only
when it is missing and never resets an existing one. Once the owner changes a
password in the app, the Secret Manager value is out of date, and the new
password exists only in the database.

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

This **pins** traffic to `<revision-name>`. The service stops following the
latest revision: anything deployed with `--no-traffic` gets 0% while the pin
is in place.

To lift the pin, either:

- **Let the next deploy do it.** Each deploy puts the new revision up as
  `candidate` with no traffic and smoke-tests it on the tag URL. Then it runs
  `update-traffic --to-latest`, which removes the pin and sends 100% to the
  new revision. Finally it checks that 100% really is on the latest revision
  and smoke-tests the main URL. If the candidate smoke test fails, the pin
  and the rolled-back revision stay as they are.
- **Do it by hand**, for example to go back to the newest revision without a
  new deploy:

  ```bash
  gcloud run services update-traffic grace-shop-uat --to-latest \
    --project=project-f4cd7300-6eb7-46cc-be3 --region=africa-south1
  ```

So a rollback is meant to hold until a fix is merged. Merging to `master`
deploys the fix and un-pins traffic in one go. Do not merge anything you are
not ready to serve.

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
| Candidate smoke test failed | The new revision exists with the `candidate` tag and 0% traffic. Users are still on the previous revision. Fix the problem and merge again. |
| `100% of traffic is not on the new revision` | Promotion did not take effect. Check `gcloud run services describe grace-shop-uat` for the traffic split. |
