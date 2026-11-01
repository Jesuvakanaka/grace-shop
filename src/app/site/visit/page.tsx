import type { Metadata } from "next";
import { buildVisitModel } from "@/components/storefront/info/info-model";
import { VisitView } from "@/components/storefront/info/VisitView";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { getShellData } from "@/lib/storefront/shell";

// ZP-491: Visit us. Address, the week's hours (today marked in the shop's
// time zone), contacts and map links from the site settings (cached, tag
// storefront:settings, revalidated on save). The page renders per request
// (the shell reads the Host header), so "today" is always current.
export const metadata: Metadata = {
  title: "Visit us",
  description: "Find the VYRA store: address, opening hours, WhatsApp and directions.",
};

export default async function VisitPage() {
  const shell = await getShellData();
  const model = buildVisitModel({ settings: shell.settings, now: new Date() });
  return <VisitView model={model} shopHref={sitePath(shell.base, SITE_ROUTES.shop)} />;
}
