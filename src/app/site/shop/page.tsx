import type { Metadata } from "next";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { routeMetadata } from "@/lib/storefront/route-metadata";

// ZP-514: /shop folds into the feed (New in); the address keeps working.
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata(SITE_ROUTES.shop, { title: "Shop", description: "Every VYRA piece, one look at a time. WEAR DIFFERENT." });
}

export default function ShopPage() {
  return <FeedRoute route={{ route: "shop" }} />;
}
