// ZP-487: the owner's lookbook photos (public/brand/lookbook/). Pure manifest.
// Campaign images, not products: never link them to a product page unless the
// owner publishes a matching product (docs/storefront/brand-refinements.md).
//
// Each photo has a small (640 wide) and a large file. The large files are not
// all 1200 wide (the name is the size class), so the srcset uses the real
// widths; tests/storefront-shell.test.ts checks them against the files.
import type { StorefrontImageData } from "./types";

export const LOOKBOOK_STEMS = [
  "lime-pleated-dress",
  "olive-print-pleated-dress",
  "olive-print-jumpsuit",
  "chartreuse-fringe-knit-set",
  "bronze-pleated-set",
] as const;

export type LookbookStem = (typeof LOOKBOOK_STEMS)[number];

export type LookbookVariant = { src: string; width: number; height: number };

export type LookbookEntry = {
  stem: LookbookStem;
  /** Describes the outfit. */
  alt: string;
  /** What the photo suits best (from the brand refinements). */
  goodFor: string;
  small: LookbookVariant;
  large: LookbookVariant;
};

const DIR = "/brand/lookbook";

function entry(
  stem: LookbookStem,
  alt: string,
  goodFor: string,
  small: [number, number],
  large: [number, number],
): LookbookEntry {
  return {
    stem,
    alt,
    goodFor,
    small: { src: `${DIR}/${stem}-640.webp`, width: small[0], height: small[1] },
    large: { src: `${DIR}/${stem}-1200.webp`, width: large[0], height: large[1] },
  };
}

export const LOOKBOOK: Readonly<Record<LookbookStem, LookbookEntry>> = Object.freeze({
  "lime-pleated-dress": entry(
    "lime-pleated-dress",
    "Model in a lime pleated midi dress with puff sleeves and a matching belt, carrying a cream handbag",
    "Home hero (primary)",
    [640, 960],
    [1024, 1536],
  ),
  "olive-print-pleated-dress": entry(
    "olive-print-pleated-dress",
    "Model in an olive and cream print pleated shirt dress with a belt, beside a VYRA sign",
    "About / brand band",
    [640, 960],
    [1024, 1536],
  ),
  "olive-print-jumpsuit": entry(
    "olive-print-jumpsuit",
    "Model in an olive and cream print wrap top with olive wide-leg trousers, beside a VYRA sign",
    "Visit us / collections",
    [640, 960],
    [1024, 1536],
  ),
  "chartreuse-fringe-knit-set": entry(
    "chartreuse-fringe-knit-set",
    "Model in a chartreuse knit top and skirt with cream fringe trim, leaning on a green car",
    "Collection tile",
    [640, 1136],
    [740, 1314],
  ),
  "bronze-pleated-set": entry(
    "bronze-pleated-set",
    "Model in a bronze metallic pleated top and maxi skirt with a black sash belt",
    "Elegant looks tile",
    [640, 965],
    [910, 1372],
  ),
});

/** `srcset` for a lookbook photo: "<small> 640w, <large> <width>w". */
export function lookbookSrcSet(stem: LookbookStem): string {
  const { small, large } = LOOKBOOK[stem];
  return `${small.src} ${small.width}w, ${large.src} ${large.width}w`;
}

/**
 * A lookbook photo as StorefrontImageData, for Hero, CategoryTile, StorefrontImg.
 * Pass `{ alt: "" }` when the photo is decorative (the link or heading names it).
 */
export function lookbookImage(stem: LookbookStem, options: { alt?: string } = {}): StorefrontImageData {
  const { large, alt } = LOOKBOOK[stem];
  return {
    src: large.src,
    srcSet: lookbookSrcSet(stem),
    alt: options.alt ?? alt,
    width: large.width,
    height: large.height,
  };
}
