"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { frameHeightFix } from "@/lib/storefront/feed";
import { isFeedFrame } from "@/lib/storefront/product-landing";

/**
 * Samsung Internet and some Android Chrome versions size 100dvh / 100svh /
 * 100vh taller than the area left by their bottom toolbar or gesture bar,
 * which cuts off the bottom of the feed (the swipe hint, caption, rail). After
 * mount and on every viewport change, compare the frame with what is really
 * visible (visualViewport.height when not pinch-zoomed, else innerHeight) and,
 * only when the frame is taller, pin it to that height (`data-vh` +
 * `--sf-visible-h`). No scroll listeners: resize events only.
 */
function useVisibleViewportHeight(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        // Measure with the CSS height (without a previous fix).
        el.removeAttribute("data-vh");
        const fix = frameHeightFix({
          frameHeight: el.getBoundingClientRect().height,
          innerHeight: window.innerHeight,
          visualHeight: vv?.height ?? null,
          visualScale: vv?.scale ?? 1,
        });
        if (fix === null) return;
        el.style.setProperty("--sf-visible-h", `${fix}px`);
        el.setAttribute("data-vh", "");
      });
    };
    check();
    window.addEventListener("resize", check);
    window.visualViewport?.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, [active]);
  return ref;
}

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
  // ZP-512: /p/<slug> is the feed too (isFeedFrame); its 404 keeps the header.
  const home = isFeedFrame({ segment, pathname });
  const frameRef = useVisibleViewportHeight(home);
  if (home) {
    return (
      // The visible viewport: 100dvh, else 100svh, else 100vh (.sf-feed-frame in
      // globals.css), corrected from JS where the browser still makes it taller
      // than what is on screen (useVisibleViewportHeight).
      <div ref={frameRef} className="sf-feed-frame overflow-hidden bg-brand-cream text-brand-ink">
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
