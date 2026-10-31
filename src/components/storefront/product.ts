// Pure helpers that turn the public product DTO into what the cards show.
import type { Availability, PublicImage, PublicProduct, StorefrontImageData } from "./types";

/**
 * Default product URL: `/site/p/<slug>`. It works on both front doors: the
 * admin/UAT host serves /site/** directly, and the storefront host 308s
 * /site/p/<slug> to its clean /p/<slug> (src/lib/host-routing.ts). Pages on the
 * storefront host can pass `hrefFor={(slug) => `/p/${slug}`}` to skip the hop.
 */
export function productHref(slug: string): string {
  return `/site/p/${encodeURIComponent(slug)}`;
}

/** "$45" for whole dollars, "$45.50" otherwise; null when there is no public price. */
export function formatPriceUsd(priceUsd: number | null): string | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return Number.isInteger(priceUsd) ? `$${priceUsd}` : `$${priceUsd.toFixed(2)}`;
}

export const ASK_FOR_PRICE = "Ask for price";

/** Badge text for a stock state, or null when in stock (badges show only for few-left / sold-out). */
export function availabilityLabel(availability: Availability): string | null {
  switch (availability) {
    case "FEW_LEFT":
      return "Few left";
    case "SOLD_OUT":
      return "Sold out";
    case "IN_STOCK":
      return null;
  }
}

export function toImageData(image: PublicImage): StorefrontImageData {
  return {
    src: image.url,
    alt: image.alt,
    width: image.width ?? undefined,
    height: image.height ?? undefined,
  };
}

/** Primary photo (first) and hover photo (second), as the DTO orders them. */
export function cardImages(product: PublicProduct): { primary?: StorefrontImageData; hover?: StorefrontImageData } {
  const [first, second] = product.images;
  return { primary: first ? toImageData(first) : undefined, hover: second ? toImageData(second) : undefined };
}
