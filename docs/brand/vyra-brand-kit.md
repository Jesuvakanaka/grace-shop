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
