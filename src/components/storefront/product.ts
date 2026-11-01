// Pure price helpers for the storefront (the feed caption, the details card,
// the piece's metadata). ZP-514: the product cards and their helpers went
// with the grid pages; the feed is the one view.

/** "$45" for whole dollars, "$45.50" otherwise; null when there is no public price. */
export function formatPriceUsd(priceUsd: number | null): string | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return Number.isInteger(priceUsd) ? `$${priceUsd}` : `$${priceUsd.toFixed(2)}`;
}

export const ASK_FOR_PRICE = "Ask for price";
