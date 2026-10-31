# August trip import (ZP-468)

Imports the owner's `August trip.xlsx` (50 items with pictures) as it is. The owner completes missing details in the app afterwards.

The spreadsheet is **not** in git and must never be committed or copied into the image. It contains private purchase data and is about 16 MB.

## Running it

```bash
# Dry run: reads the file and reports, writes nothing
npm run import:august -- "path/to/August trip.xlsx" --dry-run

# Real import (create-only, safe to re-run)
npm run import:august -- "path/to/August trip.xlsx"

# From a private bucket (Cloud Run job, ZP-472); uses application default credentials
npm run import:august -- gs://<bucket>/<path>/August-trip.xlsx --dry-run

# Options: --json (machine-readable report), --sheet <name> (default: first sheet)
```

The CLI needs `DATABASE_URL` and the image storage env (below). Exit code 1 means the input could not be read or a picture could not be stored. Re-running fixes missing pictures.

The report shows rows, products to create or skip, conflicts, pictures found and matched, unmatched pictures, total units, cost total, and every "needs details" row with its reasons.

## Mapping (exactly as written, nothing guessed)

| Spreadsheet | Product |
|---|---|
| sheet row N | `itemNumber` = `AUG-N`; `sourceFilename`, `sourceSheetName`, `sourceRowNumber` = N |
| Description | `productName` (trimmed) |
| Quantity ("Quanity") | `openingQuantity` = `currentQuantity`, plus one `StockMovement` (`OPENING_BALANCE`, `referenceType: IMPORT`). Blank means 0 and no movement. |
| Unit Price RMB, else Price RMB | `unitCostRmb` (blank means 0) |
| Unit Price USD, else Price Cost USD | `unitCostUsd` (blank means 0) |
| Selling price Retail | `sellingPriceUsd` (blank or non-numeric means 0). `sellingPriceRmb` stays 0. |
| Selling price Wholesale | `wholesalePriceUsd` (blank means NULL, "not set") |
| Wholesale Quantity | `wholesaleMinQuantity` (blank means NULL) |
| Picture (in-cell or floating) | `imageUrl` = `/api/images/<hash>.webp` |

Columns are found by header name, not position.

**Notes.** Every product gets `notes` that say where it came from and what was blank or odd. For example:

- "Quantity blank in spreadsheet; description says '5 White shirts'."
- "Selling price Retail cell contains '\' (not a usable number); left empty."
- "Same picture as spreadsheet row 3."

**Numbers.** Rounded USD values stay rounded.

**Open question.** The owner has not confirmed whether Price RMB is per unit or per line. It is stored as `unitCostRmb` as written. The report's cost total assumes it is per unit and says so.

## "Needs details"

`src/lib/product-completeness.ts` gives the reasons. It is shared by the import report and by the Products page badge and filter. ZP-468 adds `quantity`:

- **Rule:** a product needs "quantity" when it was imported (`sourceFilename` is set) and `openingQuantity === 0 && currentQuantity === 0`.
- **When it clears:** as soon as the owner sets stock. An imported row that had a quantity keeps its `openingQuantity`, so selling it out does not flag it again.
- **Known limit:** a no-quantity row that the owner stocks and then sells out completely shows up again.
- **Products created in the app:** they never need "quantity", because 0 on hand is normal there.

The other reasons are unchanged from ZP-475: cost price, retail price and wholesale price.

## Re-run safety

The import is create-only, keyed on `AUG-<row>`:

- **Existing products:** an existing product from the same file and row is left untouched, so the owner's edits are never overwritten.
- **Pictures:** attached only while `imageUrl` is still empty.
- **Stock:** the import movement is added to an existing product only if it has no stock movements at all and 0 stock, so stock never doubles.
- **Conflicts:** an `AUG-<n>` product from another source is reported as a conflict and not touched.

Running the import twice gives identical counts and units. This is covered by `tests/august-trip-import.test.ts` and was checked against a real database.

## Pictures

**Where they come from.** In the August file, all 36 pictures are "Place in cell" images. The chain is:

1. the cell's `vm` attribute,
2. `xl/metadata.xml`,
3. `xl/richData/rdrichvalue.xml` (with its structure),
4. `richValueRel.xml` and its `.rels`,
5. `xl/media/*`.

Excel stores an identical picture once, so 43 rows use 36 images. Seven rows have no picture: 16, 32, 33, 35, 43, 48 and 49.

The single floating object in `xl/drawings/drawing1.xml`, anchored at A18, is an empty AutoShape with no image data. The import reports it and ignores it. Row 18 has its own in-cell picture. Real floating pictures (`xdr:pic`) are supported and mapped to the row of their top-left anchor.

**Processing.** Pictures go through `src/lib/storage/images.ts`, the same pipeline as the owner's upload:

- the real type is sniffed from the bytes (JPEG, PNG, GIF or WebP only);
- sharp auto-rotates, resizes to at most 1200 px on the longest side, re-encodes to WebP quality 80 and strips metadata;
- the result is stored under a content-hashed key, `products/<sha256 prefix>.webp`, so re-runs are idempotent.

The August pictures shrink from about 16 MB to 2.4 MB.

**Storage.** Set by `GRACE_IMAGE_STORAGE`:

- `local` (default): files under `GRACE_IMAGE_DIR`, which defaults to `<cwd>/.data/uploads`. That folder is gitignored. Files are not put in `public/`, because standalone Next does not serve files added after start.
- `gcs`: private objects in `GRACE_IMAGE_BUCKET`, read with application default credentials. On Cloud Run that is the runtime service account, which has objectUser on the bucket.

**Serving.** `GET /api/images/<32 hex>.webp`:

- needs a signed-in user (any role), otherwise 401;
- accepts only that exact file-name pattern, otherwise 400, so there is no path traversal;
- streams the bytes with `Content-Type: image/webp`, `Cache-Control: private, max-age=86400` and `X-Content-Type-Options: nosniff`.

The browser caches pictures privately for a day, so a cached picture can still show briefly after logout on the same device. The server itself refuses requests without a session.

**Upload.** `POST /api/upload` is owner-only: 401 without a session, 403 for staff. It uses the same pipeline and never trusts the client's filename, extension or MIME type. The page shows pictures with `next/image` set to `unoptimized`, because the optimizer would fetch them without the user's cookie.

## Owner workflow in the app (Products page)

- The list (desktop) and the cards (mobile) show the picture, a **Needs details** badge, and the missing reasons in plain text.
- The **Needs details only** filter lists the incomplete rows.
- **Edit** lets the owner:
  - change the name, cost RMB/USD, retail price, and wholesale price and minimum quantity;
  - replace or remove the picture;
  - set **Stock on hand**.
- A changed stock value is recorded through the existing owner-only `POST /api/stock-movements/adjust`, as an `ADJUSTMENT` movement in the stock ledger.
- The notes field shows the original spreadsheet remarks.

## Cloud Run (ZP-472) prerequisites

The runtime image does not yet contain `src/` or `tsconfig.json`. The CLI is a `tsx` script that imports `src/lib/...` through the `@/` path alias, so the Dockerfile runtime stage needs:

```dockerfile
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
```

Then run the job command `npm run import:august -- gs://<bucket>/<object> [--dry-run]`, with `GRACE_IMAGE_STORAGE=gcs` and `GRACE_IMAGE_BUCKET` set.
