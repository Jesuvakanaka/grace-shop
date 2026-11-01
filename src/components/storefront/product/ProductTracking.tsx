"use client";

// ZP-493: the product page's analytics (docs/storefront/analytics.md).
// - product_open once per piece shown, `from` the in-app previous path
//   (NavMemory) or the referrer (src/lib/storefront/tracking.ts).
// - One delegated click listener for the page's links and buttons marked
//   `data-track`: "enquire" (whatsapp_enquire, or restock_request when sold
//   out, with the chosen size / colour), "call", "directions", "visit_us".
//   Server-rendered links need no client wrapper, and nothing re-renders.
// Render inside <ProductEnquiryProvider> (it reads the chosen options).
// On preview pages the tracker is off (src/lib/analytics/client-core.ts).
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";
import { productOpenSource } from "@/lib/storefront/tracking";
import { previousPathname } from "./NavMemory";
import { useEnquiry } from "./ProductEnquiry";

export function ProductTracking({ slug }: { slug: string }) {
  const { colour, size, soldOut } = useEnquiry();
  const options = useRef({ colour, size, soldOut });
  useEffect(() => {
    options.current = { colour, size, soldOut };
  }, [colour, size, soldOut]);

  useEffect(() => {
    // After the site layout's NavMemory has recorded this navigation (its effect may run after ours).
    const timer = setTimeout(() => {
      track("product_open", {
        slug,
        from: productOpenSource({
          previousPath: previousPathname(),
          referrer: document.referrer,
          origin: window.location.origin,
          currentPath: window.location.pathname,
        }),
      });
    });
    return () => clearTimeout(timer);
  }, [slug]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const el = (event.target as Element | null)?.closest?.("[data-track]");
      if (!el) return;
      const kind = el.getAttribute("data-track");
      const o = options.current;
      if (kind === "enquire") {
        if (o.soldOut) track("restock_request", { slug, screen: "product", size: o.size ?? undefined });
        else track("whatsapp_enquire", { slug, screen: "product", size: o.size ?? undefined, colour: o.colour ?? undefined });
      } else if (kind === "call") {
        track("call", { slug, screen: "product" });
      } else if (kind === "directions") {
        track("directions", { screen: "product" });
      } else if (kind === "visit_us") {
        track("visit_us", { screen: "product" });
      }
    };
    // Capture: counted even if a handler stops the click.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [slug]);

  return null;
}
