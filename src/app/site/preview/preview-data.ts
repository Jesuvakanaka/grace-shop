// ZP-481 design preview: placeholder catalogue. Not real stock, not real prices.
import type { Availability, PublicImage, PublicProduct, StorefrontImageData } from "@/components/storefront/types";
import { heroArt, productArt, type Garment, type ToneName } from "./placeholder-art";

/** Placeholder chat link; the real wa.me link logic is ZP-490. */
export const WHATSAPP_HREF = "#enquire";

type Seed = {
  name: string;
  garment: Garment;
  tone: ToneName;
  altTone: ToneName;
  priceUsd: number | null;
  category: string;
  isNew?: boolean;
  availability?: Availability;
  /** Preview only: point the first photo at a missing file to show the fallback tile. */
  brokenPhoto?: boolean;
};

const seeds: Seed[] = [
  { name: "Lime wrap midi dress", garment: "dress", tone: "limeOnCream", altTone: "oliveOnCream", priceUsd: 68, category: "Dresses", isNew: true },
  { name: "Cream tailored blazer", garment: "blazer", tone: "creamOnOlive", altTone: "creamOnStone", priceUsd: 95, category: "Tailoring", isNew: true },
  { name: "Black wide-leg trousers", garment: "trousers", tone: "inkOnLime", altTone: "inkOnCream", priceUsd: null, category: "Tailoring", isNew: true, availability: "FEW_LEFT" },
  { name: "Signature lime tote with woven label", garment: "tote", tone: "limeOnCream", altTone: "limeOnInk", priceUsd: 42, category: "Accessories", isNew: true },
  { name: "Olive ribbed knit", garment: "knit", tone: "oliveOnCream", altTone: "creamOnStone", priceUsd: 54, category: "Knitwear" },
  { name: "Cream poplin shirt", garment: "top", tone: "creamOnStone", altTone: "creamOnOlive", priceUsd: 38, category: "Tops", availability: "FEW_LEFT" },
  { name: "Lime co-ord set", garment: "set", tone: "limeOnInk", altTone: "limeOnCream", priceUsd: null, category: "Sets" },
  { name: "Black slip dress", garment: "dress", tone: "inkOnCream", altTone: "inkOnLime", priceUsd: 62, category: "Dresses", availability: "SOLD_OUT" },
  { name: "Lime tailored trousers", garment: "trousers", tone: "limeOnCream", altTone: "oliveOnCream", priceUsd: 58, category: "Tailoring" },
  { name: "Black cropped blazer", garment: "blazer", tone: "inkOnLime", altTone: "inkOnCream", priceUsd: 89, category: "Tailoring" },
  { name: "Cream knit tank", garment: "knit", tone: "creamOnOlive", altTone: "creamOnStone", priceUsd: 34, category: "Knitwear", isNew: true },
  { name: "Cream canvas tote", garment: "tote", tone: "creamOnStone", altTone: "creamOnOlive", priceUsd: null, category: "Accessories", brokenPhoto: true },
];

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * A srcset shaped like the real one (ZP-484's publicImageSrcSet). The art
 * route ignores `?w=` (SVG scales), so every candidate is the same picture.
 */
export function previewSrcSet(url: string): string {
  return [480, 828, 1200].map((w) => `${url}?w=${w} ${w}w`).join(", ");
}

function toPublicImage(image: StorefrontImageData): PublicImage {
  return {
    url: image.src,
    srcSet: previewSrcSet(image.src),
    alt: image.alt,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}

/** Placeholder products in the public DTO shape (ZP-484 PublicProduct). */
export const products: PublicProduct[] = seeds.map((s) => {
  const images = [
    productArt(s.garment, s.tone, `${s.name}, placeholder illustration`),
    productArt(s.garment, s.altTone, `${s.name}, detail`, { detail: true }),
    productArt(s.garment, s.altTone, `${s.name}, on the rail`),
    productArt("label", "creamOnStone", "VYRA woven label detail"),
  ].map(toPublicImage);
  if (s.brokenPhoto) {
    const missing = "/site/preview/art/missing-photo.svg";
    images[0] = { ...images[0], url: missing, srcSet: previewSrcSet(missing) };
  }
  return {
    slug: slug(s.name),
    name: s.name,
    description: null,
    category: { slug: slug(s.category), name: s.category },
    colours: null,
    sizes: null,
    availability: s.availability ?? "IN_STOCK",
    images,
    isNew: s.isNew ?? false,
    featured: false,
    priceUsd: s.priceUsd,
  };
});

export const newArrivals = products.filter((p) => p.isNew).slice(0, 4);
export const featured: PublicProduct = {
  ...products[0],
  description:
    "A fluid wrap dress in our signature lime, cut to sit softly at the waist and fall just below the knee. Wear it with cream for daytime, or black for the evening.",
  colours: "Lime, Cream, Black",
  sizes: "XS, S, M, L, XL",
  featured: true,
};
export const related = [products[4], products[5], products[8], products[1]];

export const hero = heroArt("A model in a head-to-toe lime outfit against greenery and cream stone, holding a cream VYRA bag");

export const editImage = productArt("blazer", "limeOnCream", "Lime tailored blazer on a hanger in a cream stone niche");
export const visitImage = productArt("rail", "creamOnStone", "A clothes rail of lime, cream and black pieces in the VYRA store");

export const categories = [
  { name: "Dresses", meta: "18 pieces", image: productArt("dress", "oliveOnCream", "") },
  { name: "Tailoring", meta: "24 pieces", image: productArt("blazer", "inkOnLime", "") },
  { name: "Knitwear", meta: "12 pieces", image: productArt("knit", "creamOnOlive", "") },
  { name: "Accessories", meta: "9 pieces", image: productArt("tote", "limeOnCream", "") },
];

export const filterChips = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Dresses", value: "dresses" },
  { label: "Tailoring", value: "tailoring" },
  { label: "Knitwear", value: "knitwear" },
  { label: "Tops", value: "tops" },
  { label: "Sets", value: "sets" },
  { label: "Accessories", value: "accessories" },
];

export const sortOptions = [
  { label: "Newest", value: "newest" },
  { label: "Price: low to high", value: "price-asc" },
  { label: "Price: high to low", value: "price-desc" },
];
