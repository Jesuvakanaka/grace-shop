// ZP-1200: the browser Meta Pixel. Rendered by the storefront layout ONLY when the pixel gate passes
// (src/lib/marketing/pixel.ts); otherwise nothing from this file is in the page at all.
import Script from "next/script";
import { pixelBaseSnippet } from "@/lib/marketing/pixel";

/** Base code + PageView. next/script loads it once per visit, after hydration. */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {pixelBaseSnippet(pixelId)}
    </Script>
  );
}
