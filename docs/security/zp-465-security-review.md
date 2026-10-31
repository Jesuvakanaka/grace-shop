# ZP-465 – Security hardening before hosting real data

Branch `zp-465-security`. Scope: the four items in ZP-465 plus the orchestrator guidance (setup takeover window, change-password, role audit).

## 1. JWT secret fails closed

`src/lib/auth.ts` used to fall back to the literal `'secret-key'` when `JWT_SECRET` was missing. Anyone who knew that could forge an OWNER session.

Now:
- `getJwtSecret()` runs **when a token is signed or verified**, not when the module loads. `next build` still works without secrets: the build was run with `JWT_SECRET` unset.
- If `JWT_SECRET` is missing or shorter than 32 characters and `NODE_ENV` is not `development`/`test`, it **throws**. An unset `NODE_ENV` counts as production.
- In development/test only, it falls back to a clearly-named dev secret (`grace-shop-insecure-dev-only-…`).
- `verifyToken()` now pins `HS256` and checks the payload shape. It also resolves the key outside its try/catch, so a misconfigured secret isn't silently treated as "signed out".
- `authorize()` (see 4) turns a misconfigured secret into a generic `500 {"error":"Server misconfigured"}` and logs the reason on the server.

Tests: `tests/auth-secret.test.ts` (8 tests) cover production without/with a short/with a strong secret, an unset NODE_ENV, the dev/test fallback, lazy resolution, and a token signed with the dev fallback being rejected under a production secret.

**Deployment requirement:** set `JWT_SECRET` (32 or more random characters, from Secret Manager) on the Cloud Run service.

## 2. Default credentials

- The `Default credentials: owner / owner123` hint is gone from `src/components/LoginPage.tsx`.
- `scripts/init-system.js` `seedUsers()` takes `GRACE_OWNER_PASSWORD` / `GRACE_STAFF_PASSWORD` from the environment.
  - With `NODE_ENV=production`, both are required and must be at least 12 characters. If not, the script exits non-zero **before creating anything**.
  - Outside production it falls back to `owner123` / `staff123` with a warning, because local e2e tests rely on those values.
  - Passwords are never printed. The `Created:` lines and the final summary show usernames only.
- New **change-password** feature, so the owner can replace a generated password:
  - `POST /api/auth/change-password`: needs a signed-in user and the current password. The new password must be at least 12 characters, must not equal the username (case-insensitive, trimmed), and must differ from the current one.
  - Validation is a pure function, `src/lib/password-policy.ts`, unit-tested in `tests/password-policy.test.ts` (10 tests).
  - The screen is `/settings/password` ("Change Password"), linked from the mobile More sheet and the desktop sidebar for both roles.
- `docs/business-control/05-owner-uat-script.md` now says the UAT passwords are provided separately (Secret Manager).
- **Deployment requirement:** the ZP-463 image runs with `NODE_ENV=production`, so the Cloud Run seed job (`npm run init`) must be given `GRACE_OWNER_PASSWORD` and `GRACE_STAFF_PASSWORD` from Secret Manager. Without them it refuses to seed and exits 1.

Seed check, run against a throwaway DB:

| Case | Exit | Users created |
|---|---|---|
| `NODE_ENV=production`, no passwords | 1 | 0 |
| `NODE_ENV=production`, short passwords | 1 | 0 |
| `NODE_ENV=production`, only owner set | 1 | 0 |
| `NODE_ENV=production`, strong passwords | 0 | 2. The env passwords verify, `owner123` does not, and no password appears in the output |
| No `NODE_ENV`, no passwords | 0 | 2, with a warning, using the dev defaults |

## 3. First-time setup takeover window

While the user table was empty, `POST /api/auth/setup` let anyone create an OWNER. On a freshly deployed, not-yet-seeded Cloud Run service, that is a takeover window.

Now, with `NODE_ENV=production`, it returns `403 {"error":"First-time setup is disabled on this server"}` **before touching the database**, unless `ALLOW_SETUP=true` (the exact string) is set. Outside production the behaviour is unchanged.

Tests: `tests/setup-guard.test.ts` (5 tests), including a direct call to the route handler.

## 4. Role audit (server-side)

All API handlers now use one helper, `authorize(request, roles?)` in `src/lib/api-auth.ts`:

- No, invalid, tampered or expired token: `401 {"error":"Unauthorized"}`
- Valid token with a role not in the allowed list (including unknown roles): `403 {"error":"Forbidden"}`

The old `requireRole()` is removed. It threw an `Error`, so most callers returned **500** instead of 401/403.

The policy follows `docs/business-control/02-mvp-webapp-spec.md`, the UI (STAFF cannot see Import Data or Exchange Rate) and the UAT script (STAFF does sales, expenses, debtor/creditor payments, cash and the day-closing draft).

| # | Method | Route | Before | After |
|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | public | public (unchanged) |
| 2 | POST | `/api/auth/logout` | public | public (unchanged) |
| 3 | GET | `/api/auth/session` | public, 401 when signed out | unchanged (AuthProvider relies on it) |
| 4 | POST | `/api/auth/setup` | **public; OWNER creatable while no users exist** | public, but 403 in production unless `ALLOW_SETUP=true` |
| 5 | POST | `/api/auth/change-password` | (new) | session (any role) |
| 6 | GET | `/api/health` | (added by ZP-463, not on this branch) | public – not touched |
| 7 | GET | `/api/cash` | **none** | session |
| 8 | POST | `/api/cash` | session | session |
| 9 | GET | `/api/closing` | **none** | session |
| 10 | POST | `/api/closing` (save draft) | **none** (saved as `system`) | session |
| 11 | POST | `/api/closing/[id]/close` | OWNER via `requireRole`, **500 on failure** | OWNER (401/403) |
| 12 | GET | `/api/creditors` | **none** | session |
| 13 | POST | `/api/creditors` (create) | session + OWNER | OWNER |
| 14 | GET | `/api/creditors/[id]` | **none** | session |
| 15 | POST | `/api/creditors/[id]/payment` | **none** (recorded as `system`) | session |
| 16 | GET | `/api/dashboard` | **none** | session |
| 17 | GET | `/api/debtors` | **none** | session |
| 18 | POST | `/api/debtors` | session | session |
| 19 | GET | `/api/debtors/[id]` | **none** | session |
| 20 | POST | `/api/debtors/[id]/payment` | session | session |
| 21 | GET | `/api/exchange-rate` | **none** | session |
| 22 | POST | `/api/exchange-rate` | OWNER via `requireRole`, **500 on failure** | OWNER |
| 23 | GET | `/api/expenses/categories` | **none** | session |
| 24 | GET | `/api/expenses` | **none** | session |
| 25 | POST | `/api/expenses` | session | session |
| 26 | POST | `/api/import/cancel` | OWNER via `requireRole`, **500 on failure** | OWNER |
| 27 | POST | `/api/import/confirm` | OWNER via `requireRole`, **500 on failure** | OWNER |
| 28 | GET | `/api/import/history` | **none** | OWNER |
| 29 | GET | `/api/import/templates/[type]` | **none** | OWNER |
| 30 | POST | `/api/import/upload` | OWNER via `requireRole`, **500 on failure** | OWNER |
| 31 | GET | `/api/products` | **none** | session |
| 32 | POST | `/api/products` (create) | session + OWNER | OWNER |
| 33 | GET | `/api/products/[id]` | **none** | session |
| 34 | PUT | `/api/products/[id]` | session + OWNER | OWNER |
| 35 | DELETE | `/api/products/[id]` | session + OWNER | OWNER |
| 36 | GET | `/api/sales` | **none** | session |
| 37 | POST | `/api/sales` | session | session |
| 38 | GET | `/api/sales/[id]` | **none** | session |
| 39 | GET | `/api/stock-movements` | **none** | session |
| 40 | POST | `/api/stock-movements/adjust` | OWNER via `requireRole`, **500 on failure** | OWNER |
| 41 | POST | `/api/upload` | OWNER via `requireRole`, **500 on failure** | OWNER |

Notes:
- There is no creditor *update* route and no delete route other than product delete. Both existing ones are OWNER-only.
- Day closing: STAFF can view the summary and save the draft. Only the OWNER can **Close Day** (spec: "Owner signs off & locks the day closing").
- Import upload/confirm/cancel/history/templates are OWNER-only, so the parsing of untrusted spreadsheet files is limited to the owner (see 5).

Tests: `tests/api-permissions.test.ts` calls every handler above (rows 5 and 7–41, 36 handlers) directly with a `Request`:
- no cookie (expects 401)
- a tampered token (expects 401)
- a STAFF token (expects 403 for OWNER-only handlers, otherwise allowed)
- an OWNER token (expects allowed)

That is 146 tests including the consistent-body and unknown-role checks. Mutating handlers get a malformed body, so once a request passes the auth check it fails while parsing and never writes.

Red: 64 of 146 failed against the original handlers. Green: all pass.

### 4a. Audit fields and mass assignment (review fix)

- `POST /api/sales` and `POST /api/expenses` used to spread `...rest` after `createdBy: session.username`. A STAFF user could post `"createdBy":"owner"`.
- `src/lib/expenses.ts` passed `{...data}` straight into `prisma.expense.create`, so a client could set any column (`id`, `createdAt`, …).
- Now both routes allow-list the body fields, and `createdBy` always comes from the session. `createExpense` writes explicit columns only.
- `POST /api/products` now sets `createdBy` after `...rest`. `src/lib/products.ts` was left alone because ZP-475 owns it. Its `create` already writes explicit columns.
- Tests: section 6 of `tests/business-rules.test.ts` posts `createdBy: 'owner'` (plus `id`/`createdAt` for expenses) as STAFF, or `createdBy: 'someone-else'` as OWNER for products, and checks the stored row. Red: all 3 tests stored the spoofed value. Green: all 3 store the session username.

## 5. xlsx (SheetJS)

npm `xlsx@0.18.5` has advisories with no fix on npm: prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9). It has been replaced with the maintained SheetJS build from the official CDN:

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

0.20.3 is the version the current SheetJS Node.js install docs reference. The lockfile pins the sha512 integrity. Its 8 transitive dependencies (`adler-32`, `cfb`, `codepage`, `crc-32`, `frac`, `ssf`, `wmf`, `word`) are gone.

The parsers (`src/lib/import/*`) and `scripts/init-system.js` work unchanged: `npm run init` imports 48 products plus opening stock, and the unit tests pass.

**Docker/CI note:** `npm ci` must be able to reach `cdn.sheetjs.com`.

## 5a. Next.js security upgrade (orchestrator decision)

`next@16.2.10` has critical RCE advisories, including Image Optimization RCEs that affect `next/image` on glibc Linux (Cloud Run).

- `next` 16.2.10 → **16.4.3** and `eslint-config-next` → **16.4.3**. `sharp` is a transitive dependency of `next`, and moves 0.34.5 → **0.35.5**.
- Upgrade notes (`node_modules/next/dist/docs/01-app/02-guides/upgrading/`):
  - The only 16.3 codemod (`cache-components-instant-false`) applies to Cache Components, which this app doesn't use.
  - `eslint-config-next@16.4` still supports ESLint 9.
  - No `next.config.ts` changes were needed. The ZP-463 config (`output: 'standalone'`, `outputFileTracingRoot`, `turbopack.root`) builds unchanged, and `.next/standalone/server.js` is emitted.
- **Behaviour change found:** Next 16.4's build type-checks every file in the tsconfig `include` (`**/*.ts`), so `tests/` is checked too. Two test files had type errors that already existed and now broke `npm run build`. I fixed them with type-only edits, without changing what the tests check:
  - `tests/business-rules.test.ts`: added `assert.ok(mapped.mapped)` before dereferencing it.
  - `tests/db-safety.test.ts` (from ZP-464): replaced the regex `s` flag (needs ES2018; the target is ES2017) with `[\s\S]*`, and cast the child-process `env` (Next's types make `NODE_ENV` required).
- `npm audit fix` was run without `--force`. It also *downgraded* the `prisma` CLI 6.19.3 → 6.12.0 to avoid the `deepmerge-ts` advisory. **I reverted that and pinned `prisma@^6.19.3`.** A CLI older than `@prisma/client` 6.19.3, and older than the version ZP-464's migrations were made with, risks generate/migrate mismatches. The advisory is stack exhaustion when merging recursive objects inside the Prisma CLI's config loader (migrate/generate time), so attackers can't reach it at runtime.

`npm audit`, full history:

| Stage | Total | Critical | High | Moderate |
|---|---|---|---|---|
| Original master (xlsx 0.18.5, next 16.2.10) | 29 | 1 | 12 | 16 |
| After the xlsx swap | 28 | 1 | 11 | 16 |
| After next/eslint-config-next 16.4.3 | 26 | 0 | 9 | 17 |
| Final: after `npm audit fix` + prisma kept at 6.19.3 | **19** | **0** | **3** | **16** |

Remaining:
- `deepmerge-ts` (high, 3 entries: `deepmerge-ts` → `@prisma/config` → `prisma`). This is the Prisma CLI. It shows under `npm audit --omit=dev` too, because `@prisma/client` peers on `prisma`. Follow-up: upgrade Prisma when a 6.x release ships `deepmerge-ts` ≥ 8, or move to Prisma 7, which is a separate migration.
- `minimatch` (moderate, 16 entries): only inside the ESLint toolchain (`eslint`, `typescript-eslint`, `eslint-plugin-*`). Dev-only. Fixing it needs `--force` / major ESLint changes.

## 6. Decisions recorded (not changed here)

| Topic | Decision |
|---|---|
| Login rate limiting / lockout | Out of scope for ZP-465. Bcrypt cost 10 slows guessing, and the owner sets a strong (12+ char) password. Follow-up: add rate limiting (e.g. Cloud Armor or an in-app limiter) before wider exposure. |
| Session revocation | JWTs are stateless and valid for 24h. Changing a password or deactivating a user does not revoke existing tokens, and `/api/auth/session` doesn't check `active`. Accepted for UAT (two users). Follow-up: a token version or `passwordChangedAt` claim. |
| `proxy` (formerly middleware) | Not used. Checks live in each handler through `authorize()`, so they are unit-testable and can't be skipped by a matcher mistake. Pages are client components and all data comes from the protected APIs. |
| CSRF | The cookie is `httpOnly`, `sameSite=lax`, and `secure` in production. Mutating APIs are POST/PUT/DELETE with JSON bodies, and SameSite=Lax stops cross-site cookie sending for those. No extra token for now. |
| Error messages | **Fixed for the auth paths:** `auth/login` and `auth/setup` now return a generic `500 {"error":"Internal Server Error"}` and `console.error` the detail; malformed JSON is a 400. `authorize()` returns a generic `500 {"error":"Server misconfigured"}`. Other business handlers still return `error.message` on 500; most of those are business-rule messages the UI shows (e.g. "Insufficient stock"). Follow-up: split user-facing errors from internal ones. |
| `/api/upload` file extension | **Recorded follow-up for ZP-468 (upload rewrite).** OWNER-only. It checks MIME type and size, but takes the extension from the client-supplied filename, so an owner could store e.g. `.html` under `/uploads` (stored XSS risk). Fix: derive the extension from a MIME allow-list and never trust `file.name`. |
| `prisma/seed.js` | Still creates and prints `owner / owner123`. `prisma/` was outside this issue's owned paths. Follow-up: align it with `init-system.js`, or delete it in favour of `npm run init`. |
| Other docs | `docs/business-control/03-implementation-walkthrough.md` and the header comment of `scripts/init-system.js` still mention the local dev defaults. They describe local development only and were left alone to avoid conflicts with ZP-464. |
| `src/app/api/products/[id]/route.ts` | Creates its own `PrismaClient` instead of using `@/lib/db`. Not security-relevant, left as is. |
| `/api/auth/session` response | Returns 401 (not `null`) when signed out, and the client relies on that. Unchanged. |
