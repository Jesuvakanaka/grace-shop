"use client";

// ZP-503: remembers the previous pathname of in-app (client) navigations, so
// the product page's back button knows whether the visitor came from the
// landing feed (src/lib/storefront/back-target.ts). Rendered once by the
// site layout, which stays mounted across client navigations. Module state:
// one value per browser tab, gone on a full page load (then the back button
// falls back to document.referrer).
import { usePathname } from "next/navigation";
import { useEffect } from "react";

let currentPath: string | null = null;
let previousPath: string | null = null;

/** The pathname before the current one in this page load; null on the first page. */
export function previousPathname(): string | null {
  return previousPath;
}

export function NavMemory() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === currentPath) return;
    previousPath = currentPath;
    currentPath = pathname;
  }, [pathname]);
  return null;
}
