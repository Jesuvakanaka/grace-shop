// ZP-481: the design preview exists only where GRACE_STOREFRONT_PREVIEW=true
// (local dev, UAT). Everywhere else the page and its art are a plain 404.
export function storefrontPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GRACE_STOREFRONT_PREVIEW === "true";
}
