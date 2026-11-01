"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { STOREFRONT_PREFIX } from "@/lib/host-routing";
import type { ReactNode } from "react";

/**
 * ZP-500: the storefront layout's frame, with a layout flag for the landing
 * page. useSelectedLayoutSegment() (called from src/app/site/layout.tsx) is
 * null on the storefront home (/site, or / on a storefront host), and also
 * while the segment's 404 boundary renders, so the pathname must be a home
 * path too ("/site" or "/": the server may see the rewritten "/site" where
 * the browser shows "/", and both count as home, so the server and client
 * render the same frame and nothing flashes).
 *
 * Home: the full-screen flip feed, so no header and no footer, and the frame
 * is exactly one small viewport high with no document scroll (the feed
 * scrolls inside itself; on iOS the URL bar then never collapses or jumps).
 * Every other page: header, main, footer as before.
 */
export function StorefrontFrame({
  skipLink,
  header,
  footer,
  children,
}: {
  skipLink: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const pathname = usePathname();
  const home = segment === null && (pathname === STOREFRONT_PREFIX || pathname === "/");
  if (home) {
    return (
      <div className="h-svh overflow-hidden bg-brand-cream text-brand-ink">
        {skipLink}
        <main id="main" tabIndex={-1} className="h-full focus:outline-none">
          {children}
        </main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-brand-cream text-brand-ink">
      {skipLink}
      {header}
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      {footer}
    </div>
  );
}
