// Shared prop shapes for the VYRA storefront components (ZP-481).
// Presentational only: the data layer (ZP-484) maps products onto these.

export type StorefrontImageData = {
  src: string;
  alt: string;
  /** Intrinsic size, used for width/height attributes so the layout never jumps. */
  width: number;
  height: number;
};

export type StockState = "in-stock" | "few-left" | "sold-out";

export type NavLink = {
  label: string;
  href: string;
};
