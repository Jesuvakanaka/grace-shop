"use client";
// ZP-1200: the Pixel's ViewContent event for one piece. Rendered by the product page ONLY when the pixel gate passes.
import { useEffect } from "react";

type Fbq = (command: string, event: string, data?: Record<string, unknown>) => void;

export function PixelViewContent({ contentId, name }: { contentId: string; name: string }) {
  useEffect(() => {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    // No price and no stock here: only which piece was looked at.
    fbq?.("track", "ViewContent", { content_ids: [contentId], content_name: name, content_type: "product" });
  }, [contentId, name]);
  return null;
}
