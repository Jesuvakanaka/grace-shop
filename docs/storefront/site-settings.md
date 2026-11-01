# Site settings (VYRA website)

ZP-486. Content that rarely changes and that the owner edits in the admin, so
a new phone number or new opening hours need no code change: contacts and
WhatsApp, opening hours, socials, about copy, the home hero, SEO defaults,
the "few left" threshold and whether item numbers are public.

- Admin page: `/website/settings` (`src/app/(admin)/website/settings/page.tsx`), OWNER only
- API: `GET` / `PUT /api/website/settings` (`src/app/api/website/settings/route.ts`), OWNER only
- Schema: `prisma/schema.prisma` (`SiteSettings`)
- Migration: `prisma/migrations/20261101120000_site_settings`
- Code: `src/lib/site-settings/`
  - `schema.ts`: types, defaults, limits, the field allow-list (pure, client-safe)
  - `validate.ts`: `validateSiteSettingsInput` and helpers (pure, client-safe)
  - `whatsapp.ts`: `buildWhatsAppLink` (pure, client-safe)
  - `diff.ts`: `changedSettings`, used by the form to send only changed fields (pure, client-safe)
  - `dto.ts`: `toPublicSiteSettings`, `publicSettingsImageUrl`, `settingsImageKeys` (pure)
  - `db.ts`: `readSiteSettings`, `updateSiteSettings` (server only)
  - `public.ts`: `getPublicSiteSettings()` (cached), `loadPublicSiteSettings(db)` (server only)
  - `revalidate.ts`: `settingsRevalidateScope`, `revalidateSiteSettings(scope)` (server only; uses the shared storefront helper)
- Tests: `tests/site-settings-validate.test.ts`, `tests/site-settings-public.test.ts`,
  `tests/site-settings-api.test.ts` (database), `tests/api-permissions.test.ts`,
  `tests/migration-site-settings.test.ts` (opt-in, see the file header)

## Decision: one typed row, not a key/value table

`SiteSettings` is a single row (`id = 1`) with one typed column per setting.

- Reasons: the fields are fixed and known, each has a real type (text,
  number, boolean, JSON for the week), and the column defaults are the
  seeded defaults. Prisma gives a typed client, and adding a setting is one
  reviewed migration. A key/value table would need its own typed schema in
  code, and every read would parse strings.
- Single row: the migration adds `CHECK ("id" = 1)`
  (`SiteSettings_single_row`). Prisma 6 cannot declare CHECK constraints, so
  they exist only in the migration SQL. `prisma migrate diff` does not report
  them as drift. `CHECK ("fewLeftThreshold" BETWEEN 1 AND 50)` backs the
  validator.
- Opening hours are one `JSONB` column, `openingHours`, shaped
  `{ mon: { closed: false, open: "09:00", close: "17:30" }, ..., sun: { closed: true } }`.
  All seven days are required. `null` means "not set" and the site should
  hide the hours. Stored JSON is re-validated on read; anything invalid
  reads as `null`.
- The migration only creates the new table and inserts the row
  (`INSERT ... ON CONFLICT DO NOTHING`, between `-- BEGIN seed` and
  `-- END seed`). No existing table changes. The opt-in migration test
  checksums every row of every existing table before and after.
- If the row is ever missing, reads return `SITE_SETTINGS_DEFAULTS` and the
  first `PUT` creates it (upsert).

## Fields and defaults

| Group | Column | Default | Rule |
| --- | --- | --- | --- |
| Contacts | `whatsappNumber` | null | E.164 (`+` and 8 to 15 digits). Spaces, `-`, `.` and `( )` are removed, so `+263 77 123 4567` is saved as `+263771234567`. |
| | `enquiryTemplate` | `Hi VYRA, I'm interested in {product} ({url})` | Required, up to 500 characters. Only `{product}`, `{url}`, `{colour}`, `{size}` and `{ref}` (ZP-504) are allowed. |
| | `generalEnquiryMessage` | `Hi VYRA, I'd like to ask about your collection.` | Required, up to 500 characters. |
| | `phone` | null | Digits, spaces, `( )`, `-`, optional leading `+`. |
| | `email` | null | Simple address check, up to 254 characters. |
| Visit us | `address` | null | Multi-line, up to 500 characters. |
| | `openingHours` | null | See above. Times are 24-hour `HH:MM`, and closing time must be after opening time. |
| | `holidayNote` | null | Up to 300 characters. |
| | `mapUrl` | null | Any `https://` URL. |
| | `latitude`, `longitude` | null | -90..90 and -180..180. Both or neither. |
| Social | `instagramUrl` | null | `https://` on `instagram.com` or a subdomain of it. |
| | `facebookUrl` | null | `https://` on `facebook.com` or `fb.com`, or a subdomain. |
| | `tiktokUrl` | null | `https://` on `tiktok.com` or a subdomain. |
| About | `aboutHeadline` | null | Up to 120 characters. |
| | `aboutStory` | null | Plain text, up to 2000 characters. |
| | `aboutImageKey` | null | Storage key (`products/<32 hex>.webp`). |
| Home | `heroHeadline` | `Style Your Way` | Required, up to 120 characters. |
| | `heroSubline` | `Premium fashion. Modern you.` | Required, up to 200 characters. |
| | `heroImageKeyDesktop`, `heroImageKeyMobile` | null | Storage keys. |
| | `statement` | `Confidence in every stitch` | Required, up to 120 characters. |
| | `trustLabel1..3` | `Premium Quality`, `Visit Our Store`, `Enquire on WhatsApp` | Required, up to 40 characters each. |
| SEO | `seoTitle` | `VYRA` | Required, up to 70 characters. |
| | `seoDescription` | `Premium fashion. Modern you.` | Required, up to 300 characters. |
| | `seoShareImageKey` | null | Storage key. |
| Availability | `fewLeftThreshold` | 3 | Whole number from 1 to 50. Pass it to `getAvailability(qty, threshold)`. |
| | `showItemNumber` | false | Show the internal item number publicly ("Ref AUG-45"). |

All URLs must be `https://` with a host and no `user:password@`. They are
stored in normalised form (`new URL(value).href`): the host is lower case,
the default port is dropped, and the path is encoded. For example,
`https://WWW.Instagram.COM/vyra` is stored as `https://www.instagram.com/vyra`.
Text is trimmed. An optional field that is blank is saved as `null`. A
required field that is blank is an error.

**Characters.** Every string field rejects control characters, including NUL,
tab, DEL and the C1 controls. It also rejects the bidi embedding, override
and isolate characters U+202A–U+202E and U+2066–U+2069, which can make public
text display differently from what was typed. Either gives a 400 field error.
Line breaks are allowed only in the multi-line fields `address`, `aboutStory`
and `holidayNote` (`MULTI_LINE_FIELDS`), where CRLF and CR are saved as LF.
Every other field must be a single line. Raw URLs are checked before parsing,
because `new URL()` silently strips tabs and newlines.

The featured-products order is not here. Featured flags and `sortOrder` live
on each product (ZP-482/ZP-483).

**ZP-513 (details card).** `holdHours` (integer 1–168, default null:
no "We hold it for … h" until the owner sets it), `paymentMethods` (≤ 80 characters, null hides
"Pay in store"), `defaultSizeChart` (JSON rows `{ size, bust, waist, hips }`,
≤ 12, validated by `parseSizeChart`; null = no default chart; a stored chart
that no longer validates reads as null). Public as `buying: { holdHours,
paymentMethods, sizeChart }`. See docs/storefront/feed.md, "Details card content".

## API

`GET /api/website/settings` returns `{ settings }` with every editable field.

`PUT /api/website/settings` takes a **partial** JSON object. Only the
fields present are validated and changed.

- An unknown field (anything outside `EDITABLE_FIELDS`, including `id`,
  `updatedBy` and the timestamps) gives `400 { error: "Unknown field(s): ...", fieldErrors }`.
  Nothing is written.
- A bad value gives `400 { error, fieldErrors }`, keyed by field
  (`openingHours.mon` for a single day). Every error is reported at once.
  Nothing is written.
- On success the response is `{ settings }`. `updatedBy` is set to the
  owner's username. The storefront caches are then revalidated.

Both methods are OWNER only: no session is 401 and STAFF is 403
(`tests/api-permissions.test.ts`). The admin page shows "403 · Owners only"
to STAFF. The page itself is a client page, so the browser gets a 200 for the
HTML, and the data request is what returns 403.

## Public read

```ts
import { getPublicSiteSettings, buildWhatsAppLink } from '@/lib/site-settings/public'

const settings = await getPublicSiteSettings()
const href = buildWhatsAppLink(settings, { product: name, url, colour, size }) // null => hide the button
```

`getPublicSiteSettings()` is server only (it imports Prisma). It is cached
with `unstable_cache`, the tags `storefront` and `storefront:settings`, and `revalidate: 60`.
The project does not enable Cache Components, so `'use cache'` is not
available. It returns
an allow-listed DTO (`PublicSiteSettings` in `dto.ts`):

```
contacts { whatsappNumber, enquiryTemplate, generalEnquiryMessage, phone, email }
visit    { address, hours, holidayNote, mapUrl, latitude, longitude }
social   { instagram, facebook, tiktok }
about    { headline, story, imageUrl }
home     { heroHeadline, heroSubline, heroImageUrls { desktop, mobile }, statement, trustLabels[3] }
seo      { title, description, shareImageUrl }
fewLeftThreshold, showItemNumber
```

It never includes `updatedBy`, timestamps or raw storage keys.

### `buildWhatsAppLink(settings, { product?, url?, colour?, size?, ref? })`

- Returns `https://wa.me/<digits>?text=<encodeURIComponent(message)>`, or
  `null` when no usable number is set (fewer than 8 or more than 15 digits).
- With `product`, it uses `enquiryTemplate`. The placeholders are filled in
  one pass, so text in a product name such as `{url}` is never expanded
  again. Without a `url`, only the `({url})` wrapper in the template is
  removed, before the values are filled in. Other parentheses, in the
  template or in the product name (`Tee (Kids)`), are kept. A bare `{url}`
  becomes empty. Colour and size that
  the template does not mention are added on their own lines
  (`Colour: Black`, `Size: M`).
- ZP-504: with `ref` (the product DTO's public `ref`, `"V-" + id` padded to 4
  digits, e.g. `V-0099`; never the item number) the message ends with
  ` (ref V-0099)`, or `(ref V-0099)` on its own line after added colour/size
  lines. A template that places `{ref}` itself gets no extra suffix; without a
  ref, a `({ref})` or `(ref {ref})` wrapper and a bare `{ref}` disappear. The
  feed Enquire, the feed restock message and the product page all pass it
  (`productEnquiryHref`, `toFeedItem`). The owner sees the ref in the product
  editor's Website panel ("Enquiry reference: V-0099").
- Without `product`, it uses `generalEnquiryMessage` (never a ref).
- It is tested with spaces, `&`, emoji and a missing number.

## Revalidation

After a successful `PUT`, the route compares the settings before and after
(`settingsRevalidateScope`) and calls `revalidateSiteSettings(scope)`:

- **The few-left threshold changed:** no scope, so `revalidateStorefront()`
  expires `storefront`, which is every storefront entry. The cached catalogue
  builds every product's `availability` with the threshold from settings.
- **Anything else:** `{ settings: true }` expires `storefront:settings` and
  `storefront:home`.

Revalidation goes through the one storefront helper (`revalidateStorefront`
in `src/lib/storefront/cache-tags.ts`) and its never-throwing wrapper in
`src/lib/website/revalidate.ts`, using `{ expire: 0 }`, so the next request
reads fresh data. The call never throws, because the save has already
happened. Outside a Next.js request (tests, scripts), the "static generation
store missing" error is ignored. Any other error is logged and reported as
`{ ok: false }`.

**Several instances: 60-second backstop.** `revalidateTag` clears only the
cache of the instance that handled the `PUT`. Cloud Run runs up to 2
instances, each with its own cache, so the other instance would keep the old
settings. `getPublicSiteSettings()` therefore also has `revalidate: 60`
(`PUBLIC_SETTINGS_REVALIDATE_SECONDS`). The instance that saved shows the
change on its next request. Every other instance shows it within a minute,
which meets "the storefront reflects it within a minute". Storefront pages
that embed the settings in their own cache (ZP-481/ZP-484) need the same
60-second backstop, or a shared cache handler, to keep this promise.

The admin form validates every field, but it sends only the fields that
changed (`changedSettings` in `src/lib/site-settings/diff.ts`, with latitude
and longitude always sent together).

## Settings pictures are served publicly

Settings pictures are uploaded through the existing `/api/upload` pipeline.
That pipeline stores them as `products/<32 hex>.webp`, the same as product
pictures, and the setting stores that key. The public DTO turns a key into
`/api/images/public/<32 hex>.webp`.

Since the Phase 1 consolidation, the public image route's visibility check
(`isPublicImageKey` in `src/lib/storefront/queries.ts`) also accepts the
**current** settings pictures (`settingsImageKeys()`, through
`isSettingsImageKey` in `src/lib/site-settings/db.ts`). The check runs
uncached on every request, before the resize cache. When the owner replaces
a picture, the old key is a 404 (`no-store`) at once, unless a public product
or published category still uses it. The width allow-list and headers are
the same as for product pictures.

## Navigation

The Sidebar and MoreSheet are not changed here. The ZP-483 categories page
(`/website/categories`) has a tab bar that links to `/website/settings`.
