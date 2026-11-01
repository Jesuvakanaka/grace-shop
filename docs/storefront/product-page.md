# Storefront product page (ZP-490)

`/p/<slug>` on the storefront host, `/site/p/<slug>` on the admin/UAT host.
Brand rules: `docs/storefront/brand-refinements.md`. Shared plumbing:
`docs/storefront/shell.md`. Data: `docs/storefront/public-data-layer.md`.

## Files

| File | What |
|---|---|
| `src/app/site/p/[slug]/page.tsx` | Route: decision, metadata, data for the view |
| `src/components/storefront/product/ProductView.tsx` | Layout (server component) |
| `src/components/storefront/product/ProductEnquiry.tsx` | Client: chosen colour/size (one provider), chips, enquiry button (inline + sticky) |
| `src/components/storefront/product/ShareButton.tsx` | Client: `navigator.share`, falling back to copying the link, with a polite live region |
| `src/lib/storefront/product-route.ts` | Pure: `decideProductRoute`, `previewTokenFrom`, `isProductPreviewRequest`, `PREVIEW_RESPONSE_HEADERS`, `productAbsoluteUrl` |
| `src/lib/storefront/product-enquiry.ts` | Pure: `productEnquiryHref` (wraps `buildWhatsAppLink`), `enquiryLabel`, `splitOptions`, `toggleOption`, `telHref` |
| `src/lib/storefront/related.ts` | Pure: `pickRelated` |
| `src/lib/storefront/preview.ts` | Server, uncached: `loadPreviewCandidate` (any product by current slug) |
| `tests/storefront-product.test.ts` | Unit tests for all of the pure parts |

## Route decision

`decideProductRoute({ slug, previewToken }, deps)`:

| Case | Result |
|---|---|
| Invalid slug | 404, no lookup at all |
| Public product | Page (a `?preview=` token is ignored: no banner) |
| Old slug of a public product (`ProductSlugRedirect`, via the cached catalogue) | `permanentRedirect` (308) to `sitePath(base, SITE_ROUTES.product(current))`, so it works on both hosts |
| Not public, no token | 404 |
| Not public, token valid for exactly this product (`verifyPreviewTokenFor(token, productId)`) | Owner preview |
| Not public, token for another product, expired, tampered or garbage | 404 |
| Unknown slug | 404 |

The page and `generateMetadata` share one decision per request (React
`cache`). `previewTokenFrom` accepts exactly one non-empty `preview` value of
at most 2048 characters.

## Owner preview

The admin's "Preview on site" button (`POST /api/website/products/:id/preview-token`)
opens `previewUrlFor(slug, token)` = `/site/p/<slug>?preview=<token>`: the
same path and parameter this route reads. `STOREFRONT_PRODUCT_PAGE_READY` is
now `true`, so the button reads "Preview on site".

- The draft is loaded by `loadPreviewCandidate` (`getProductPreviewCandidate`
  in `@/lib/storefront`), only when the slug is not public and a token is
  present, and used only after the token verifies for that product id. It is a
  direct, uncached Prisma read built by the same allow-list (`toPublicProduct`),
  so a preview never enters the two shared cache entries.
- Pictures of an unpublished product are not served by the public image route,
  so the preview DTO points them at the signed-in route `/api/images/<hex>.webp`
  (no width variants). The owner opening the link from the back office is
  signed in on that host. Anyone else with the link sees the cream fallback.
- The page shows a "Preview, not public" banner, and metadata
  `robots: noindex, nofollow, nocache` and `referrer: no-referrer`.
- **Headers.** In Next 16.4.3 a page component cannot set response headers
  (only Route Handlers, `next.config` `headers()` and the proxy can). The
  proxy (`src/proxy.ts`) therefore adds `PREVIEW_RESPONSE_HEADERS` to every
  product URL that carries a `preview` parameter, valid or not, on both hosts:

  ```
  Referrer-Policy: no-referrer
  Cache-Control: private, no-store
  ```

  Measured on `next start`: the proxy's `Cache-Control` replaces Next's default
  `private, no-cache, no-store, max-age=0, must-revalidate` for those URLs
  (both forbid shared caching). The token still appears in Next's own RSC
  payload of the current URL inside that private, no-store response; it never
  appears in a link, image URL or the WhatsApp message.

## Layout

- **Phones:** gallery (swipe, dots) → serif name → price or "ASK FOR PRICE" →
  availability badge (Few left / Sold out only) → colour and size chips →
  description → "Available in-store and on WhatsApp" → Call us / Share →
  enquiry button → "You may also like".
- **Desktop (lg):** thumbnail rail and large photo on the left; details in a
  sticky right column with the inline enquiry button.
- **Zoom:** click/tap the photo or the expand button. Native modal `<dialog>`
  (rest of the page inert), arrows change photo, Esc closes, Tab cycles the
  dialog's buttons, focus returns to the expand button. The fade and smooth
  scrolling are off under `prefers-reduced-motion` (existing `globals.css`).
- Item number ("Ref AUG-45") only when the settings `showItemNumber` is on;
  the DTO then carries `itemNumber` (`includeItemNumber`).
- No stock counts, cost or other private fields: the page only sees
  `PublicProduct` and `PublicSiteSettings`.

## WhatsApp enquiry

- Built only with `buildWhatsAppLink` (through `productEnquiryHref`) from the
  site settings template, with the product name, the chosen colour and size
  (each on its own line unless the template names `{colour}` / `{size}`), and
  the absolute product URL. Tests decode the link and check spaces, `&`, `#`,
  `?`, new lines and emoji round-trip exactly.
- Label "ENQUIRE ON WHATSAPP", or "ASK ABOUT RESTOCK" when sold out.
- No WhatsApp number: no button; "Available in-store" and a "Visit us" link.
- Phones: the button is a sticky bar (`EnquiryButton placement="sticky"`, with
  `env(safe-area-inset-bottom)` padding) placed as a direct child of the
  `<article>` between the details and "You may also like". It pins to the
  bottom of the screen while the content above it is on screen and then
  settles in its place, so it is in the flow (its own height is the bottom
  padding) and never covers the related products or the footer.
- Secondary: "Call us" (`tel:`) when a phone is set; "Share" when the absolute
  URL is known.

### Absolute product URL

`productAbsoluteUrl` (used in the message, Share and `og:url`):

1. A configured storefront host (`GRACE_STOREFRONT_HOSTS`, first valid entry)
   is the public origin: `https://<host>/p/<slug>`.
2. Otherwise (UAT today) the request `Host` header, validated as a plain
   `host[:port]`: `https://<host>/site/p/<slug>`, `http` for localhost.
   `X-Forwarded-Host` and `X-Forwarded-Proto` are never read.
3. Anything malformed: no URL; the template's "({url})" is dropped.

Built on the shared `absoluteSiteUrl` / `cleanHost` in `src/lib/storefront/public-url.ts`
(also used for the listing pages' canonical URLs, ZP-489).

A preview never puts the token in the URL it shares or sends.

## Related products

`pickRelated(listPublishedProducts({ categorySlug, pageSize: 48 }).items, product)`:
up to 4 from the same category, never the product itself, in catalogue
order, available pieces first; sold-out pieces only fill remaining places,
last. No related products: the section is hidden.
