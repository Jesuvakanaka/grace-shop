import type { Metadata } from "next";
import { StorefrontNotFoundContent } from "./not-found-content";

// ZP-487: the storefront 404, inside the storefront shell. Shown for notFound()
// in any storefront page and, through ./[...missing]/page.tsx, for every
// unknown storefront URL. The admin keeps its own 404 (src/app/not-found.tsx).
// Kept synchronous (no headers() here): the link base comes from the
// SiteBaseProvider that the layout already set up.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function StorefrontNotFound() {
  return <StorefrontNotFoundContent />;
}
