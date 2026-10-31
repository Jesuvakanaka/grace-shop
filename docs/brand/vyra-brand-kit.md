# VYRA brand kit

VYRA is the customer-facing name for Grace Shop. This internal stock, cash and credit app now uses the VYRA look. The repo, package name, Cloud Run services, database names, env vars, cookies and log prefixes still say "grace". Only the user-facing name changed.

> **The mark was redrawn.** The owner has no original logo files. Every file in `public/brand/` was redrawn from a written description of the brand board: palette, mark shape, wordmark and tagline. If the owner later finds the original vector files, replace the SVGs with them and run the generator again so the icons match.

## Palette

| Swatch | Hex | Token (Tailwind 4 `@theme`) | Use it for |
|---|---|---|---|
| Lime | `#9BB21E` | `brand-lime` | The signature accent: active-nav indicators, focus rings, highlight bars, badges **with dark text**. Never put white text on lime. |
| Olive | `#5F7A1F` | `brand-olive` (= `brand-olive-600`) | Primary buttons (white text), the hero card, headline numbers, and depth. |
| Cream | `#EDE6D3` | `brand-cream` (= `brand-cream-200`) | The page background. Cards stay white so they stand out from it. |
| Near-black | `#1E1E1E` | `brand-ink` (also `slate-900`) | Body text and headings. |

Tints and shades, defined in `src/app/globals.css`:

- `brand-olive-50 … 900`: `50` `#F4F6EA` (success / active backgrounds), `100` `#E6ECCF`, `200` `#CDD9A3`, `700` `#4A6018` (button hover, olive text on light or cream), `900` `#2A3610` (success toast).
- `brand-lime-50 … 700`, used for subtle highlights such as `bg-brand-lime/10` on a drag target.
- `brand-cream-50 … 400`: `100` `#F6F2E8` is the raised surface (table headers, stat boxes).
- **Warm neutrals:** the app's existing `slate-*` utilities point to a warm grey ramp, so greys sit well on cream: `400` `#7A7468`, `500` `#6B655B`, `600` `#55514A`, `900` `#1E1E1E`.
- **Status colours stay semantic.** Red/rose means errors, amber means warnings and the "Needs details" badge, sky means info. The CSS warning and info tokens were darkened (`#B45309`, `#0369A1`) so their badge text passes AA.

## Contrast (WCAG 2.x)

Computed with the standard relative-luminance formula. Text needs at least 4.5:1, and non-text UI and large text need at least 3:1.

| Pair | Ratio | Needed | Result |
|---|---|---|---|
| Ink text on cream page | 13.38:1 | 4.5 | Pass |
| Ink text on white card | 16.67:1 | 4.5 | Pass |
| White on olive (primary button, hero card) | 4.89:1 | 4.5 | Pass |
| White on olive-700 (button hover) | 7.05:1 | 4.5 | Pass |
| Ink on lime (lime badge / chip) | 6.97:1 | 4.5 | Pass |
| Olive text on white | 4.89:1 | 4.5 | Pass |
| Olive-700 text on olive-50 (success badge, active nav) | 6.45:1 | 4.5 | Pass |
| Olive-700 text on cream | 5.66:1 | 4.5 | Pass |
| Olive-50 text on olive-900 (success toast) | 11.76:1 | 4.5 | Pass |
| slate-500 secondary text on white / on cream | 5.77:1 / 4.63:1 | 4.5 | Pass |
| slate-600 text on white / on cream | 7.89:1 / 6.33:1 | 4.5 | Pass |
| slate-400 muted text on white | 4.64:1 | 4.5 | Pass |
| slate-400 muted text on cream | 3.73:1 | 3 (large or non-essential text only) | Pass |
| Olive focus border on white (non-text) | 4.89:1 | 3 | Pass |
| Red-600 error text on white | 4.83:1 | 4.5 | Pass |
| Amber-700 warning text on amber-50 | 4.84:1 | 4.5 | Pass |
| **White on lime** | 2.39:1 | 4.5 | **Fail: never use** |
| **Olive text on cream** | 3.93:1 | 4.5 | **Fail: use olive-700 on cream** |
| Lime ring on white (non-text) | 2.39:1 | 3 | Fail on its own, so focus states pair the lime ring with an olive border (inputs) or a white gap inside the ring (`.btn`) |

## Typography

Both fonts load through `next/font/google` in `src/app/layout.tsx`. They are self-hosted at build time, so the browser makes no requests to Google.

- **Headings:** *Cormorant Garamond* (500/600/700), a high-contrast serif, exposed as `--font-cormorant` and the `font-serif` utility. `h1` and `h2` use it by default (`@layer base` in `globals.css`).
- **Body, labels, buttons:** *Jost*, a geometric sans, exposed as `--font-jost` and `font-sans` (the default).
- **Labels:** buttons (`.btn`) are small, spaced uppercase, in the style of "SHOP NOW →" (`letter-spacing: .12em`). Stat and hero labels use uppercase with wide tracking. `.brand-label` is available for new section labels. Form labels and inputs stay in sentence case so forms remain easy to read.
- The wordmark itself is drawn as paths, not set in Jost.

## Logo files

All files live in `public/brand/`. Letters are drawn as paths, never live text, so they look the same everywhere.

| File | What | Where to use |
|---|---|---|
| `vyra-mark.svg` | Two-tone V chevron. The left arm is olive, the right arm is lime, they overlap in a darker facet at the point, and a thin inner V sits inside. Square 512 viewBox. | App header and sidebar, tags, bags, anything 48 px and up. |
| `vyra-mark-small.svg` | The same mark without the inner V. | 16 to 40 px, such as the favicon and browser tab. |
| `vyra-mark-mono.svg` | One colour (`currentColor`). The left arm stops short of the right arm, so the overlap still reads. | One-colour print, embossing, stamps, small sizes on photos. |
| `vyra-wordmark.svg` | "VYRA" in widely tracked geometric capitals over "WEAR DIFFERENT". Near-black. | Headers where the mark already appears nearby. |
| `vyra-lockup.svg` | Mark above the wordmark and tagline. | Login page, receipts, signage. |
| `vyra-wordmark-cream.svg` | `vyra-wordmark.svg` with a cream (`#EDE6D3`) fill. Hand-derived (ZP-481), not written by the generator. | The ink storefront footer and other dark grounds. |
| `vyra-icon-192.png`, `vyra-icon-512.png`, `vyra-icon-maskable-512.png` | The mark on cream. | Web manifest (phone home screen). |

App icons in `src/app/`:

- `icon.svg`: small mark on a rounded cream tile.
- `apple-icon.png`: 180×180, full mark on cream.
- `favicon.ico`: 16, 32 and 48 px, small mark.
- `manifest.ts`: name and short name "VYRA", olive theme colour, cream background.

**Regenerate** after changing any shape: `node docs/brand/generate-vyra-logos.mjs . <previewDir>`. It rewrites everything above and puts PNG previews in `<previewDir>`.

### Do

- Keep clear space around the mark of at least the width of one arm (about a fifth of the mark's width).
- Put the colour mark on cream or white. On near-black, use the mono mark in cream.
- Use `vyra-mark-small.svg` or the mono mark below 40 px.
- Use the wordmark and lockup at least 200 px wide. Below that, "VYRA" still reads but "WEAR DIFFERENT" does not, so use the mark alone, as the app header does.
- Keep the left arm olive and the right arm lime.

### Don't

- Don't swap, recolour or gradient the arms, and don't add shadows or outlines.
- Don't stretch, rotate or re-track the wordmark, and don't retype it in a font.
- Don't put white text on lime, or use lime as a button background with white text.
- Don't put the colour mark on photos or busy patterns. Use the mono mark on a solid area.
- Don't use olive for body text on cream. Use olive-700 or ink.

## Naming

- User-visible "Grace Shop" became **VYRA** in: the page `<title>` ("VYRA - Stock, Cash & Credit"), the login header (lockup plus "Stock, Cash & Credit" and the tagline "Wear Different"), the desktop sidebar, the mobile top bar, and the print header ("VYRA · Stock, Cash & Credit").
- Left as "Grace Shop" on purpose: infrastructure and docs (`.github/workflows/deploy-uat.yml`, `docs/deployment/*`). These describe the internal service, which is still called grace-shop on Cloud Run.

## Storefront

The public VYRA site (ZP-481). Components live in `src/components/storefront/`, the storefront CSS utilities (`sf-*`) at the end of `src/app/globals.css`, and a design preview of every component at `/site/preview` (only when `GRACE_STOREFRONT_PREVIEW=true`; never indexed).

### Personality

- Premium, warm, confident and uncluttered: a boutique lookbook, not a marketplace.
- Photography carries the page. The interface stays quiet: cream grounds, hairlines, small spaced labels, no shadows, no rounded "app" shapes.
- Mood: a model in head-to-toe lime against greenery and cream stone; lime and cream shopping bags; black woven labels; a clothes rail of lime, cream and black.
- Headlines: "Style your way", "Elevate your style", "Be bold. Be you."

### Colour

| Role | Colour | Token | Rules |
|---|---|---|---|
| Page (about 70% of every page) | Cream `#EDE6D3` is the dominant ground. Cream-light `#F6F2E8` only for an occasional alternate section (one per page, e.g. "Shop by category") and image tiles | `brand-cream`, `brand-cream-100` | The default ground. |
| Text, wordmark, footer | Ink `#1E1E1E` | `brand-ink` | Secondary text is ink-soft `#55514A` (`brand-ink-soft`). |
| Primary buttons, links | Olive `#5F7A1F`, hover `#4A6018` | `brand-olive`, `brand-olive-700` | Buttons: white text on olive. **Text** links and olive labels on cream use olive-700, because olive text on cream is 3.93:1. |
| Accent only | Lime `#9BB21E` | `brand-lime` | Thin rules, active states, badges with ink text, the NEW badge, focus rings, and occasional full-bleed colour blocks. **Never white text on lime.** |
| Cards, inputs, chips | White | `white` | |

All text meets WCAG AA. The hero overlay uses a deep-olive gradient (`#2A3610`, 85% at the left edge, 76% at 45%, clear by 75%) so its white text stays AA over any photo.

### Type

- **Headings:** Cormorant Garamond, weight 500, line-height 1.1, sentence case.
  - Hero: 72px on desktop, 40px on a 375px phone (`.sf-display`, fluid).
  - Section titles: 32–40px (`.sf-title`). Product name: 32px (`.sf-product-title`). Card names: 20–22px, clamped to 2 lines.
- **Body:** Jost 16–17px, line-height 1.6, max 65 characters per line (`.sf-body`).
- **Labels, buttons, nav, badges:** Jost 12–13px (never smaller), uppercase, 0.18–0.2em tracking (`.sf-label`, `.sf-label-lg`), e.g. "SHOP THE COLLECTION →".
- **Prices:** Jost 18px medium (`.sf-price`). No price shows "ASK FOR PRICE" in the olive-700 label style.
- **Wordmark:** always the SVG paths (`<Wordmark>` in `Brand.tsx`, or the files above), never typed. In the header it is the letters only; "WEAR DIFFERENT" only appears at 200px wide and up (the footer).

### Layout

- Mobile-first. Content max width 1200px (`<Container>`): 16px gutters on phones, 24–32px above.
- Section padding: 56–64px on phones, 96–112px on desktop (`<Section>`).
- Product grid: 2 columns on phones, 3 on tablets, 4 on desktop (`<ProductGrid columns={2|3|4}>`).
- Corners: 0–2px. Buttons, badges, chips and image frames are 2px. Editorial, not bubbly.
- Rules: 1px hairlines at 10% ink. A 40×3px lime rule sits above section titles (`.sf-rule`).
- Tap targets: at least 44×44px everywhere (buttons, nav, chips, dots, icon buttons).

### Imagery

- Product cards: 4:5 portrait, `object-fit: cover`, on cream-light.
- Heroes: 16:9 on desktop with the text over a soft gradient, or a split layout. On phones the photo is 4:5 and the text sits below it on cream, so the photo is never hidden behind text.
- Photos are visible without JavaScript and before hydration. After hydration, a below-the-fold photo that is still loading is hidden and fades in when it loads (250ms); a photo that loaded earlier stays as it is. The hero photo loads eagerly with high fetch priority (it is the LCP element) and never fades.
- Never a broken image: every frame (cards, tiles, hero, gallery, zoom) paints a cream tile with the VYRA mark first, and a photo that fails is hidden, leaving the tile (`ImageFrame` + `StorefrontImg`). Without JavaScript a CSS `::before` layer covers the browser broken-image icon.

### Components (`src/components/storefront/`)

All are presentational: they take props and fetch nothing (the data layer is ZP-484). Import from `@/components/storefront`.

| Component | What it does |
|---|---|
| `Header` | Sticky cream bar; a hairline appears once the page scrolls. Phones: hamburger, centred wordmark, WhatsApp. Desktop: wordmark left, nav (Shop · Collections · New Arrivals · About · Visit Us), WhatsApp. The phone menu is a native modal `<dialog>`: full-screen cream, large serif links, focus trapped, Esc closes and focus returns to the hamburger. |
| `Hero` | Serif headline, sub-line ("Premium fashion. Modern you."), olive primary and ghost secondary button. `layout="overlay"` or `"split"`; `as="h2"` for editorial blocks lower down. Art-directed `<picture>` (16:9 desktop, 4:5 phone). |
| `SectionHeader` | Lime rule, serif title, optional intro and "VIEW ALL →" link. |
| `ProductCard` / `ProductGrid` | Takes `product`: the public product DTO (`PublicProduct` in `types.ts`, structurally identical to ZP-484 `src/lib/storefront/dto.ts`; to be unified when ZP-484 merges). From it: link `hrefFor(slug)` (default `productHref` = `/site/p/<slug>`, which also works on the storefront host via its 308 to `/p/<slug>`), first photo, second photo on desktop hover (zoom 1.03×), NEW badge (`isNew`, not when sold out), "Few left" / "Sold out" badges (`availability` `FEW_LEFT` / `SOLD_OUT`), category name, serif name (2 lines), price `$NN` from `priceUsd` or ASK FOR PRICE when null. The whole card is one link. |
| `CategoryTile` | Image with the category name in uppercase spaced type on a cream plate (ink on cream, AA over any photo). |
| `FilterBar` | Scrollable chips (`aria-pressed`) plus a sort `<select>`. Controlled through callbacks, or local state when none are passed. Chips wrap on desktop. |
| `Gallery` | CSS scroll-snap track (swipe on phones, with dots), thumbnail rail and arrows on desktop, arrow keys on the focused track, full-screen zoom in a native `<dialog>`. No dependencies. |
| `EnquiryButton` | Full-width olive "ENQUIRE ON WHATSAPP" with the chat glyph. `placement="sticky"` pins it to the bottom of the screen on phones while the product `<article>` is in view (render it as the article's last direct child); `href` comes from the caller (wa.me logic is ZP-490). |
| `TrustStrip` | "Premium quality · Visit our store · Enquire on WhatsApp" with thin line icons. |
| `ColourBlock` | Full-bleed lime (ink text, ink button) or olive (white text, cream button) section with one serif statement ("Confidence in every stitch") and one button. At most one per page. |
| `Footer` | Ink ground, cream text, cream mono mark plus the cream wordmark with tagline, address and hours (placeholders until confirmed), social icons, link columns, "© VYRA". |
| `EmptyState`, `ErrorState`, `NotFoundState` | Mark, lime rule, serif title, a short line and one or two buttons. The 404 says "This piece has moved on" |
| `Button` | `primary` (olive), `ghost` (ink outline), `ghost-light` (white outline on dark), `ink`, `cream`, `link` (olive-700 with arrow). 2px corners, 44px min height. Renders a `Link` with `href`, else a `<button>`. |
| `Badge` | `lime` (NEW), `light` (Few left), `ink` (Sold out). |
| `Mark`, `Wordmark` | Inline SVG brand marks that take `currentColor` (mono mark, wordmark) or the brand colours (colour mark). |

### Motion

- 150–250ms ease-out. Content fades up on load (`.sf-fade-in`, 220ms). Dialogs fade in.
- `prefers-reduced-motion: reduce` turns off the fade-ups, image fades, hover zoom and smooth gallery scrolling.
- No autoplaying carousels with text. The gallery only moves when the shopper moves it.
- Focus (`.sf-focus`): a 2px lime ring outside a 2px olive inner border. The olive keeps 3.93:1 on cream where lime alone would not.

### Voice

Short, warm, second person: "Come in, take your time and try everything on." Uppercase is for labels only. Headlines are sentence case.

### Targets

WCAG 2.2 AA; tap targets at least 44px; Lighthouse mobile Performance ≥ 85, Accessibility ≥ 95, SEO ≥ 95 (measured on the preview); LCP under 2.5s.

### Storefront contrast

Computed with the WCAG 2.x relative-luminance formula. Text needs 4.5:1 and non-text UI needs 3:1.

| Pair | Ratio | Needed | Result |
|---|---|---|---|
| Ink text on cream (page, headings, body, category plate) | 13.38:1 | 4.5 | Pass |
| Ink text on cream-light #F6F2E8 (alternating sections, trust strip) | 14.91:1 | 4.5 | Pass |
| Ink text on white (cards, chips, inputs, Few left badge) | 16.67:1 | 4.5 | Pass |
| Ink-soft #55514A on cream (secondary text, sold-out size) | 6.33:1 | 4.5 | Pass |
| Ink-soft on cream-light | 7.06:1 | 4.5 | Pass |
| Ink-soft on white | 7.89:1 | 4.5 | Pass |
| Olive-700 #4A6018 on cream (links, ASK FOR PRICE, eyebrows, icons) | 5.66:1 | 4.5 | Pass |
| Olive-700 on cream-light | 6.31:1 | 4.5 | Pass |
| White on olive (primary button, enquiry button, olive colour block) | 4.89:1 | 4.5 | Pass |
| White on olive-700 (button hover) | 7.05:1 | 4.5 | Pass |
| Ink on lime (NEW badge, lime colour block text) | 6.97:1 | 4.5 | Pass |
| Cream on ink (footer, ink button, Sold out badge, active chip, preview bar) | 13.38:1 | 4.5 | Pass |
| Cream-300 #DED4BA on ink (footer labels, copyright) | 11.30:1 | 4.5 | Pass |
| Lime on ink (footer link hover) | 6.97:1 | 4.5 | Pass |
| Ink on cream button (on olive block) | 13.38:1 | 4.5 | Pass |
| White on hero gradient, worst case (75% deep olive over white) | 5.88:1 | 4.5 | Pass |
| Lime-200 #DDE88F eyebrow on hero gradient, worst case (82% at 6-16% of the width) | 5.59:1 | 4.5 | Pass |
| White on hero gradient at 0% (left edge, 85%) | 8.05:1 | 4.5 | Pass |
| Non-text: olive focus border on cream | 3.93:1 | 3 | Pass |
| Non-text: lime focus ring on ink (footer) | 6.97:1 | 3 | Pass |
| Non-text: ghost button border (ink) on cream | 13.38:1 | 3 | Pass |
| Non-text: active gallery dot (ink) on cream | 13.38:1 | 3 | Pass |
| Non-text: inactive gallery dot (ink 50%) on cream | 3.08:1 | 3 | Pass |
| White on lime (never used) | 2.39:1 | 4.5 | **Fail** |
| Olive #5F7A1F text on cream (never used; use olive-700) | 3.93:1 | 4.5 | **Fail** |

### Implementation notes

- The admin CSS sets `* { border-color: … }` outside any cascade layer, which beats Tailwind's layered `border-*` colour utilities. Storefront components therefore use the important form (`border-brand-ink/10!`, `divide-brand-ink/10!`) wherever the border colour matters.
- The `sf-*` typography and scroller classes sit in `@layer components`, so Tailwind utilities can still override them; focus, image-state and motion rules sit outside layers on purpose.
- Plain `<img>` is used for now (local files and preview SVGs with explicit sizes). Switch `StorefrontImg` to `next/image` once ZP-484 serves real photos.
- The design preview draws its placeholder "photography" as SVG (`src/app/site/preview/placeholder-art.ts`, served by `src/app/site/preview/art/[key]/route.ts`). It never uses the private August packing shots or any external image host.
