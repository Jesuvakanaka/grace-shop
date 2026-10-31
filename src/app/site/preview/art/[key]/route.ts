import { renderArt } from "../../placeholder-art";
import { storefrontPreviewEnabled } from "../../preview-gate";

// ZP-481 design preview: placeholder art as SVG, e.g. /site/preview/art/dress.limeOnCream.svg.
// Same gate as the preview page: 404 unless GRACE_STOREFRONT_PREVIEW=true.
// Unknown or malformed names (extra segments, "dress.constructor.svg",
// "__proto__", ...) are a plain 404, never a 500.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  let svg: string | null = null;
  if (storefrontPreviewEnabled()) {
    try {
      svg = renderArt(key);
    } catch {
      svg = null;
    }
  }
  if (svg === null) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
    },
  });
}
