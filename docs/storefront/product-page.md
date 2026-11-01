# /p/<slug>: the piece URL (ZP-490, ZP-512)

`/p/<slug>` on the storefront host, `/site/p/<slug>` on the admin/UAT host.
ZP-512: there is no separate product page any more. This URL renders the
flip feed on that look with its details sheet open (see the end of
`docs/storefront/feed.md`). Route: `src/app/site/p/[slug]/page.tsx`; pure parts:
`src/lib/storefront/product-route.ts`, `product-landing.ts`, `product-enquiry.ts`,
`product-page-enquiry.ts`; tests: `tests/storefront-product.test.ts`,
`tests/storefront-product-landing.test.ts`.

## Route decision

`decideProductRoute({ slug, previewToken }, deps)`:

| Case | Result |
|---|---|
| Invalid slug | 404, no lookup at all |
| Public product | The feed on that look, sheet open (a `?preview=` token is ignored: no banner) |
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
- ZP-512: the feed with just that look and its sheet open (details from the
  server, no heart, no Share) under a slim "Preview, not public" strip; metadata
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

## WhatsApp enquiry

- Built only with `buildWhatsAppLink` (through `productEnquiryHref`) from the
  site settings template, with the product name, the chosen colour and size
  (each on its own line unless the template names `{colour}` / `{size}`), and
  the absolute product URL. Tests decode the link and check spaces, `&`, `#`,
  `?`, new lines and emoji round-trip exactly.
- Label "ENQUIRE ON WHATSAPP", or "ASK ABOUT RESTOCK" when sold out. ZP-503:
  sold-out pieces send the feed's restock message (`RESTOCK_TEMPLATE`) through
  `productPageEnquiryHref`; the public ref (ZP-504, `product.ref`) is passed
  to the link builder in both cases.
- ZP-512: the button is the details sheet footer's (with Call and Share);
  no WhatsApp number: Visit us.

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

