// Shared prop shapes for the VYRA storefront components (ZP-481).
// Presentational only: the data layer (ZP-484) maps products onto these.

export type StorefrontImageData = {
  src: string;
  alt: string;
  /** Intrinsic size for width/height attributes (stops layout jumps). Optional: frames have a fixed ratio. */
  width?: number;
  height?: number;
};

export type NavLink = {
  label: string;
  href: string;
};

/*
 * Public product shape, structurally identical to `PublicProduct` in ZP-484's
 * src/lib/storefront/dto.ts (branch zp-484-public-data-layer, not merged yet),
 * with the model enum values from src/lib/storefront-model/rules.ts. Defined
 * here so the design system does not import an unmerged module.
 * TODO(ZP-484): unify — replace with `import type { PublicProduct } from "@/lib/storefront/dto"`.
 */
export type Availability = "IN_STOCK" | "FEW_LEFT" | "SOLD_OUT";

export type PublicImage = {
  url: string;
  alt: string;
  /** Null until the data layer stores image sizes. */
  width: number | null;
  height: number | null;
};

export type PublicCategoryRef = { slug: string; name: string };

export type PublicProduct = {
  slug: string;
  name: string;
  description: string | null;
  category: PublicCategoryRef;
  colours: string | null;
  sizes: string | null;
  availability: Availability;
  /** Primary first, then gallery order. */
  images: PublicImage[];
  isNew: boolean;
  featured: boolean;
  /** Only when the price is shown; null means "ask for price". */
  priceUsd: number | null;
  /** Only when the caller opted in. */
  itemNumber?: string;
};
