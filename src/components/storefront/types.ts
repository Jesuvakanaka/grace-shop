// Shared prop shapes for the VYRA storefront components (ZP-481).
// Presentational only: the data layer (ZP-484) maps products onto these.

export type StorefrontImageData = {
  src: string;
  /** `srcset` candidates ("url 320w, …"). Pair with a `sizes` value. */
  srcSet?: string;
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
 * The public product DTO comes from the data layer (ZP-484). These are
 * TYPE-ONLY imports: they are erased at compile time, so no server code
 * (Prisma, next/cache) reaches client components. Never turn them into value
 * imports.
 */
export type { Availability } from "@/lib/storefront-model/rules";
export type { PublicImage, PublicCategoryRef, PublicProduct } from "@/lib/storefront/dto";

/** A top-level nav item; `children` makes it a sub-menu (Collections). */
export type NavItem = NavLink & { children?: NavLink[] };

export type SocialIcon = "instagram" | "facebook" | "tiktok" | "whatsapp";
export type SocialLink = { label: string; href: string; icon: SocialIcon };

