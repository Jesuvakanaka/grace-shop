# About and Visit us pages (ZP-491)

Two storefront pages built from the public site settings
(`docs/storefront/site-settings.md`). Brand rules: `docs/storefront/brand-refinements.md`.

| Route | File |
|---|---|
| `/about` (`/site/about` on UAT) | `src/app/site/about/page.tsx` |
| `/visit` (`/site/visit` on UAT) | `src/app/site/visit/page.tsx` |

Code in `src/components/storefront/info/`:

| File | What |
|---|---|
| `info-model.ts` | Pure: `buildAboutModel`, `buildVisitModel`, `weekHours`, `dayInTimeZone`, `mapLink`, `directionsLink`, `mapEmbedUrl`, `telHref`, `meaningfulText`, `storyParagraphs`, `settingsImageData`. |
| `AboutView.tsx` | Split tile (headline + story on cream, photo beside it) and the "What WEAR DIFFERENT. means" block with the olive "Shop the collection" button. |
| `VisitView.tsx` | Heading, action buttons, address, week hours, contact, socials, side photo. |
| `MapEmbed.tsx` | Client: click-to-load Google map. |

Tests: `tests/storefront-about-visit.test.ts` (pure, no database).

## About

- Headline: `aboutHeadline`, else "Be bold. Be you." (the brand board's campaign line).
- Story: `aboutStory`, split into paragraphs on blank lines. Hidden when missing.
- Photo: the settings about picture, else the lookbook `olive-print-pleated-dress` (VYRA sign). Eager (LCP).
- "What WEAR DIFFERENT. means": fixed default copy (`DEFAULT_MEANING`); site settings have no field for it yet.
- Blank values and placeholders (`TBC`, `TBA`, `TBD`, `Coming soon`, `-`, `...`) count as missing, so "TBC" never shows.

## Visit us

| Block | Source | Hidden when |
|---|---|---|
| Address | `address`, one line per row | not set |
| Opening hours | `openingHours`, Monday to Sunday, today marked (`aria-current="date"`, tinted row and a visible "Today" label) | not set |
| Holiday note | `holidayNote` | not set |
| Contact | `phone` (`tel:` digits only), `email` (`mailto:`) | each when not set |
| WhatsApp us | `buildWhatsAppLink(settings)` (general enquiry) | no usable number |
| Call us | `phone` | no phone |
| Get directions | Google Maps directions to the coordinates or address, else the owner `mapUrl` | none of these |
| Open in Google Maps | owner `mapUrl`, else a Google Maps search for the address, else the coordinates | none of these |
| Show map | iframe `https://www.google.com/maps?q=…&output=embed`, only after a click. Coordinates or address only; the owner `mapUrl` is never framed | no address or coordinates |
| Follow VYRA | `SocialIcons` (same list as the header and footer) | no profiles |

"Today" uses the shop time zone `Africa/Harare` (`SHOP_TIME_ZONE`; settings have no time
zone field). The page renders per request, so "today" is current.

With nothing set the page shows only the heading, the photo and an "Explore the collection" link.

## Updating without a deploy

Both pages read `getShellData()`, which uses the cached `getPublicSiteSettings()`
(tags `storefront`, `storefront:settings`, 60 s backstop). `PUT /api/website/settings`
revalidates the tag, so a change shows on the next request. Verified locally by changing
`aboutHeadline` through the API and reloading `/site/about`.

## Follow-up

The home page (ZP-488) has its own today's-hours and map-link helpers with the same
behaviour. Unify them (for example in `src/lib/storefront/visit-model.ts`) once both are merged.
