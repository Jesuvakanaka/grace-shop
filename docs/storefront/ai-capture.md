# AI product capture (ZP-1100)

The owner photographs a garment on a phone in the admin (`/capture`). The site
then writes the listing (Claude, or OpenAI when Claude is unavailable) and, in
AI mode, makes 3 VYRA model photos (OpenAI `gpt-6.2-astra` with its image
generation tool). The owner reviews and approves; approval creates a normal
Product (with gallery) and can publish it. Two listing types: **in stock**
(e.g. a container just arrived) and **pre-order** (bought in the market, ships
in a few months).

Everything here is **OWNER only** (`authorize(request, OWNER_ONLY)`).

## Photo modes

| Mode | What the owner uploads | What AI does |
| --- | --- | --- |
| `AI` | 1 to 3 reference photos of the garment (flat-lay, hanger, close-up) | Listing text + 3 model photos |
| `OWN` | Reference photo(s) + 1 to 6 finished photos (e.g. made earlier in ChatGPT) | Listing text only |

Only the finished photos (AI or own) go on the product. The reference photos
stay on the draft as the AI's input and are never published.

## Data model

- `enum ListingType { IN_STOCK PRE_ORDER }`
- `Product.listingType ListingType @default(IN_STOCK)`
- `Product.preorderShipFrom DateTime? @db.Date`, `Product.preorderShipTo DateTime? @db.Date` (expected ship window)
- `Product.preorderExpectedQty Int?` (how many were bought; stock stays 0 until arrival)
- `ProductImage.aiGenerated Boolean @default(false)`
- `enum CaptureStatus { NEW GENERATING READY APPROVED REJECTED FAILED }`
- `enum CaptureImageMode { AI OWN }`
- `model CaptureDraft`:
  - `id Int @id @default(autoincrement())`
  - `status CaptureStatus @default(NEW)`
  - `imageMode CaptureImageMode`
  - `listingType ListingType @default(IN_STOCK)`
  - `referenceKeys String[]` storage keys of the owner's garment photos (`products/<hash>.webp`)
  - `ownKeys String[]` finished photos uploaded in OWN mode
  - `generatedKeys String[]` AI photos, index = slot (0 standing, 1 playful, 2 seated); `''` = not made yet
  - `unitCostRmb Float?`, `sellingPriceUsd Float?`, `quantity Int @default(1)`
  - `shipFrom DateTime? @db.Date`, `shipTo DateTime? @db.Date`
  - `audience String?` free hint: "women", "men", "girls", "boys", "unisex"
  - `notes String?` owner's note for the AI (e.g. "girls 4-8 years, pink")
  - `listing Json?` the listing draft (see below), editable by the owner
  - `error String?` last failure, owner-facing
  - `busySince DateTime?` set while one AI step runs (claim; stale after 6 minutes)
  - `aiCostCents Int @default(0)` estimated AI spend
  - `productId Int? @unique` + relation to `Product` (set on approve, `onDelete: SetNull`)
  - `createdBy String?`, `createdAt`, `updatedAt`
  - `@@index([status])`

Listing draft (`CaptureDraft.listing`), validated by `parseListingDraft`:

```ts
type ListingDraft = {
  publicName: string        // <= 120
  description: string       // <= 2000, VYRA voice
  categoryId: number | null // one of the existing categories
  colours: string | null    // <= 200
  sizes: string | null      // <= 200
  fabric: string | null     // <= 200
  care: string | null       // <= 200
  altText: string           // <= 200, used for every photo's alt
  details: string[]         // <= 12 items: details that must not change ("3 satin bows on bodice")
}
```

## Processing (no background server)

Cloud Run only gives CPU during a request, so there is no worker process.
The browser drives the work one step per request:
`POST /api/capture/[id]/run` does the NEXT step and returns the draft.

1. No `listing` yet: Claude reads the reference photo(s) and writes the listing draft.
2. AI mode, a slot in `generatedKeys` still empty: generate that ONE photo.
   References, in this order (the prompt names it): the garment photo(s);
   for slots 1 and 2 also slot 0's photo; and LAST the house model, when one
   is set and the draft is for women (`usesHouseModel(audience)`: children's
   and men's pieces keep the master prompt's own model guidance).
   The listing's `details` checklist goes into the photo prompt.
3. Nothing left: status `READY`.

Status is `GENERATING` while steps remain. A failed step sets `FAILED` and
`error`; calling `run` again retries the failed step. The capture page runs a
queue loop over every unfinished draft while it is open (batch mode for a
container).

## Routes (all OWNER only)

| Route | Purpose |
| --- | --- |
| `POST /api/capture` | multipart: `reference` (1-3 files), `own` (0-6 files, OWN mode), `imageMode`, `listingType`, `unitCostRmb`, `sellingPriceUsd`, `quantity`, `shipFrom`, `shipTo`, `audience`, `notes`. Files go through `saveProductImage`. |
| `GET /api/capture?status=` | list drafts (newest first) with photo URLs |
| `GET /api/capture/[id]` | one draft |
| `PATCH /api/capture/[id]` | edit `listing`, prices, quantity, listing type, ship window |
| `DELETE /api/capture/[id]` | reject (status `REJECTED`) |
| `POST /api/capture/[id]/run` | do the next step (above) |
| `POST /api/capture/[id]/regenerate` | `{ slot }`: clear and remake one AI photo |
| `POST /api/capture/[id]/approve` | `{ publish, itemNumber? }`: create the Product, gallery, website fields; publish if asked |
| `GET/PUT/DELETE /api/capture/house-model` | the house model photo (PUT multipart `photo`); stored as `SiteSettings.captureHouseModelKey`, never public |

## AI services (`src/lib/ai/`)

Chosen from the denim pinafore tests (Nov 2026): `gpt-6.2-astra` was the only
model that kept every garment detail; medium and high quality looked the same.

| Env var | Default | Use |
| --- | --- | --- |
| `OPENAI_API_KEY` | (none: AI photos disabled) | Photos: `gpt-6.2-astra` through the Responses API with the `image_generation` tool, 1024x1536. Also the listing text fallback (`gpt-6.2-astra`, which read garment details far better than `gpt-5.1`). |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` |
| `ANTHROPIC_API_KEY` | (none: OpenAI writes the text) | Claude listing text. If the key is missing or the call fails (for example out of credit), OpenAI writes it instead. |
| `ANTHROPIC_LISTING_MODEL` | `claude-opus-5-5` | |

Cost: about $0.15 per photo (from the usage OpenAI reports), so about $0.45
per garment, plus 1 to 2 cents for the text. `aiCostCents` records it.

The VYRA master prompt lives in `src/lib/ai/master-prompt.ts`. The prompt keeps
sewn-on labels and patches while forbidding added logos and text.

## Public site: pre-order

A published product with `listingType = PRE_ORDER` is never "Sold out" (its
stock is 0 until it arrives). It shows a "Pre-order" badge with the ship
window ("Pre-order · ships Feb–Mar 2027"), the WhatsApp button reads
"Pre-order on WhatsApp" and the message names the pre-order and ship window.
"Mark as arrived" in the product editor switches it to `IN_STOCK`.

## Turning it on (UAT)

1. Create the Secret Manager secrets `grace-shop-uat-openai-api-key` and
   `grace-shop-uat-anthropic-api-key`, and give the runtime service account
   `roles/secretmanager.secretAccessor` on both.
2. Set the repository variable `GRACE_AI_CAPTURE=true`. The next deploy adds
   `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` to the web service. While it is
   `false` (the default) nothing changes and AI steps fail with "key not set up".
3. Put a monthly spending cap on both AI accounts.
