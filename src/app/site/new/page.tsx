import type { Metadata } from "next";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { routeMetadata } from "@/lib/storefront/route-metadata";

// ZP-514: /new folds into the feed on New in; the address keeps working.
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata(SITE_ROUTES.newArrivals, { title: "New in", description: "The newest VYRA pieces, one look at a time." });
}

export default function NewPage() {
  return <FeedRoute route={{ route: "new" }} />;
}
