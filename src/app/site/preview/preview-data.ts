// ZP-481 design preview: placeholder catalogue. Not real stock, not real prices.
import type { ProductCardProps } from "@/components/storefront/ProductCard";
import type { StorefrontImageData } from "@/components/storefront/types";
import { heroArt, productArt, type Garment, type ToneName } from "./placeholder-art";

/** Placeholder chat link; the real wa.me link logic is ZP-490. */
export const WHATSAPP_HREF = "#enquire";

type Seed = {
  name: string;
  garment: Garment;
  tone: ToneName;
  altTone: ToneName;
  price: string | null;
  category: string;
  isNew?: boolean;
  stock?: ProductCardProps["stock"];
};

const seeds: Seed[] = [
  { name: "Lime wrap midi dress", garment: "dress", tone: "limeOnCream", altTone: "oliveOnCream", price: "$68", category: "Dresses", isNew: true },
  { name: "Cream tailored blazer", garment: "blazer", tone: "creamOnOlive", altTone: "creamOnStone", price: "$95", category: "Tailoring", isNew: true },
  { name: "Black wide-leg trousers", garment: "trousers", tone: "inkOnLime", altTone: "inkOnCream", price: null, category: "Tailoring", isNew: true, stock: "few-left" },
  { name: "Signature lime tote with woven label", garment: "tote", tone: "limeOnCream", altTone: "limeOnInk", price: "$42", category: "Accessories", isNew: true },
  { name: "Olive ribbed knit", garment: "knit", tone: "oliveOnCream", altTone: "creamOnStone", price: "$54", category: "Knitwear" },
  { name: "Cream poplin shirt", garment: "top", tone: "creamOnStone", altTone: "creamOnOlive", price: "$38", category: "Tops", stock: "few-left" },
  { name: "Lime co-ord set", garment: "set", tone: "limeOnInk", altTone: "limeOnCream", price: null, category: "Sets" },
  { name: "Black slip dress", garment: "dress", tone: "inkOnCream", altTone: "inkOnLime", price: "$62", category: "Dresses", stock: "sold-out" },
  { name: "Lime tailored trousers", garment: "trousers", tone: "limeOnCream", altTone: "oliveOnCream", price: "$58", category: "Tailoring" },
  { name: "Black cropped blazer", garment: "blazer", tone: "inkOnLime", altTone: "inkOnCream", price: "$89", category: "Tailoring" },
  { name: "Cream knit tank", garment: "knit", tone: "creamOnOlive", altTone: "creamOnStone", price: "$34", category: "Knitwear", isNew: true },
  { name: "Cream canvas tote", garment: "tote", tone: "creamOnStone", altTone: "creamOnOlive", price: null, category: "Accessories" },
];

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export type PreviewProduct = Omit<ProductCardProps, "href"> & { slug: string; category: string; photos: StorefrontImageData[] };

export const products: PreviewProduct[] = seeds.map((s) => {
  const image = productArt(s.garment, s.tone, `${s.name}, placeholder illustration`);
  const hoverImage = productArt(s.garment, s.altTone, `${s.name}, detail`, { detail: true });
  return {
    slug: slug(s.name),
    name: s.name,
    image,
    hoverImage,
    price: s.price,
    isNew: s.isNew,
    stock: s.stock,
    category: s.category,
    eyebrow: s.category,
    photos: [
      image,
      hoverImage,
      productArt(s.garment, s.altTone, `${s.name}, on the rail`),
      productArt("label", "creamOnStone", "VYRA woven label detail"),
    ],
  };
});

export const newArrivals = products.filter((p) => p.isNew).slice(0, 4);
export const featured = products[0];
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
