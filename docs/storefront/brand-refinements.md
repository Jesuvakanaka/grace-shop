# VYRA storefront: brand refinements (owner review of ZP-481, 2026-11-01)

The owner approved the `/site/preview` design direction ("keep this design and refine it, not
start again", 8.5/10 brand match). Phase 2 pages must apply these refinements.

## Rules

1. **Tagline.** `WEAR DIFFERENT.` is the one VYRA tagline everywhere: header lockup, footer,
   brand band, page metadata. "Style your way" / "Premium fashion. Modern you." are supporting
   campaign copy only (hero), never the tagline.
2. **Palette.** Lime/chartreuse, deep olive, cream, black, warm neutrals. Cream is the dominant
   background. Olive is the default button / action colour; lime is an accent (italic headline
   word, small highlights, the WhatsApp/primary call to action at most). Do not make whole
   sections bright lime.
3. **Premium editorial feel.** Generous whitespace, refined serif display type with tracked
   uppercase labels (see the home mock-up), consistent product cards, thin dividers.
4. **Photography.** Use the owner's model photography (`public/brand/lookbook/`) for hero,
   collection tiles and lifestyle bands. No illustrated placeholders on real pages. Products
   without a photo show a quiet cream placeholder with the VYRA mark, never an illustration.
5. **Do not redesign the brand** or introduce another visual identity.

## Reference images (`docs/brand/references/`)

- `vyra-brand-board.webp`: logo, palette dots (lime `~#9BB31C`, olive `~#6B7A2A`, cream
  `~#EDE6D6`, black `~#1E1E1E`), label, bags, campaign tiles.
- `vyra-home-mockup.webp`: the target home page layout:
  hero photo with olive left gradient, serif "Elevate Your *Style*" (italic word in lime),
  tracked uppercase sub-line, olive/lime button, three trust items under a thin rule;
  "EXPLORE OUR COLLECTIONS" heading between rules, three tall photo tiles with serif title and
  "SHOP NOW →"; cream brand band with the VYRA wordmark, WEAR DIFFERENT and an italic line
  over a fabric/photo image; slim footer with social icons.
- `vyra-lookbook-grid.webp`: style reference for future product shots (same model, same
  architectural setting, belts, cream bag).

### Showcase adaptation (not e-commerce)

The mock-up shows shop features we are **not** building yet. Replace them:

| Mock-up | VYRA showcase |
|---|---|
| Free shipping / Easy returns bar | Optional announcement text from Site settings, or nothing |
| Cart, account, currency | None. Search optional. WhatsApp enquiry instead |
| Trust: Fast shipping, Secure checkout | e.g. Premium quality, Enquire on WhatsApp, Visit our store |
| "Shop now" | "View collection" / "Explore" |
| Newsletter subscribe | Not in Phase 2 (needs consent + storage); follow socials instead |

## Lookbook photos (`public/brand/lookbook/`)

Each has a `-640.webp` and a `-1200.webp` (portrait, about 2:3). Serve with `<img srcset>`
(`640w, 1200w`) and explicit width/height to avoid layout shift.

| File stem | Look | Good for |
|---|---|---|
| `lime-pleated-dress` | Lime puff-sleeve pleated midi, cream bag | Home hero (primary) |
| `olive-print-pleated-dress` | Olive/cream print pleated shirt dress, VYRA sign | About / brand band |
| `olive-print-jumpsuit` | Print wrap top + olive wide trousers, VYRA sign | Visit us / collections |
| `chartreuse-fringe-knit-set` | Chartreuse fringe knit top and skirt | Collection tile |
| `bronze-pleated-set` | Bronze metallic pleated set | "Elegant looks" tile |

Alt text must describe the outfit (e.g. "Model in a lime pleated midi dress with puff
sleeves"). These are campaign images, not products: never link them to a product page unless
the owner publishes a matching product.
