import type { Metadata } from "next";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { routeMetadata } from "@/lib/storefront/route-metadata";
import { getShellData } from "@/lib/storefront/shell";
import { meaningfulText } from "@/lib/storefront/visit-model";

// ZP-514: /about folds into the feed with the menu open on About VYRA (the
// whole story and picture live in the menu now).
export async function generateMetadata(): Promise<Metadata> {
  const shell = await getShellData();
  const about = shell.settings.about;
  return routeMetadata(SITE_ROUTES.about, {
    title: "About",
    // Review F4: placeholders ("TBC") never reach the metadata.
    description: meaningfulText(about.headline) ?? "The story behind VYRA. WEAR DIFFERENT.",
    image: about.imageUrl ? { url: about.imageUrl, alt: "VYRA" } : null,
  });
}

export default function AboutPage() {
  return <FeedRoute route={{ route: "about" }} />;
}
