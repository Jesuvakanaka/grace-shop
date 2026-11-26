# AI product capture (ZP-1100)

The owner photographs a garment on a phone in the admin (`/capture`). The site
then writes the listing (Claude) and, in AI mode, makes 3 VYRA model photos
(OpenAI GPT Image). The owner reviews and approves; approval creates a normal
Product (with gallery) and can publish it. Two listing types: **in stock**
(e.g. a container just arrived) and **pre-order** (bought in the market, ships
in a few months).

Everything here is **OWNER only** (`authorize(request, OWNER_ONLY)`).

## Photo modes

| Mode | What the owner uploads | What AI does |
| --- | --- | --- |
| `AI` | 1 to 3 reference photos of the garment (flat-lay, hanger, close-up) | Listing text + 3 model photos |
| `OWN` | Reference photo(s) + 1 to 6 finished photos (e.g. made earlier in ChatGPT) | Listing text only |

The reference photo is always kept and added as the LAST gallery image
(`aiGenerated = false`), so customers can see the real garment.

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
   Slot 0 uses the reference photos; slots 1 and 2 also get slot 0's photo
   as the model reference, so it is the same model.
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

## AI services (`src/lib/ai/`)

| Env var | Default | Use |
| --- | --- | --- |
| `OPENAI_API_KEY` | (none: AI photos disabled) | GPT Image |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1.5` | change without a code change |
| `OPENAI_IMAGE_QUALITY` | `high` | `low` / `medium` / `high` |
| `ANTHROPIC_API_KEY` | (none: listing text disabled) | Claude listing text |
| `ANTHROPIC_LISTING_MODEL` | `claude-opus-5-5` | |

The VYRA master prompt lives in `src/lib/ai/master-prompt.ts`.

## Public site: pre-order

A published product with `listingType = PRE_ORDER` is never "Sold out" (its
stock is 0 until it arrives). It shows a "Pre-order" badge with the ship
window ("Pre-order · ships Feb–Mar 2027"), the WhatsApp button reads
"Pre-order on WhatsApp" and the message names the pre-order and ship window.
"Mark as arrived" in the product editor switches it to `IN_STOCK`.
