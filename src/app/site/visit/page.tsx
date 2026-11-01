import type { Metadata } from "next";
import { headers } from "next/headers";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { hostRoutingConfigFromEnv } from "@/lib/host-routing";
import { jsonLdScript } from "@/lib/reviews/structured-data";
import { localBusinessJsonLd } from "@/lib/storefront/one-view";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { absoluteSiteUrl } from "@/lib/storefront/public-url";
import { routeMetadata } from "@/lib/storefront/route-metadata";
import { getShellData } from "@/lib/storefront/shell";

// ZP-514: /visit folds into the feed with the menu open on Visit us (today's
// hours, the week, address, directions, map link). The store's
// LocalBusiness JSON-LD (address, hours, phone) stays on this address.
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata(SITE_ROUTES.visit, {
    title: "Visit us",
    description: "Find the VYRA store: address, opening hours, WhatsApp and directions.",
  });
}

export default async function VisitPage() {
  const [shell, h] = await Promise.all([getShellData(), headers()]);
  const url = absoluteSiteUrl({
    base: shell.base,
    path: SITE_ROUTES.visit,
    storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts,
    host: h.get("host"),
  });
  const { visit, contacts } = shell.settings;
  const jsonLd = localBusinessJsonLd({
    url,
    phone: contacts.phone,
    visit: { address: visit.address, hours: visit.hours, latitude: visit.latitude, longitude: visit.longitude },
  });
  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} /> : null}
      <FeedRoute route={{ route: "visit" }} />
    </>
  );
}
