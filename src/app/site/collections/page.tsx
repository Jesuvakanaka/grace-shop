import type { Metadata } from "next";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { routeMetadata } from "@/lib/storefront/route-metadata";

// ZP-514: /collections folds into the feed with the collections sheet open.
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata(SITE_ROUTES.collections, { title: "Collections", description: "VYRA collections, one look at a time." });
}

export default function CollectionsPage() {
  return <FeedRoute route={{ route: "collections" }} />;
}
