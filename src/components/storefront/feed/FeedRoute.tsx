// ZP-514: one view. The folded addresses (/shop, /new, /collections,
// /collections/<slug>, /about, /visit) render this: the flip feed on the
// address's collection, with its overlay (the collections sheet, or the menu
// on About / Visit us) opened after hydration, when the URL becomes the
// feed's (FlipFeed `route`). Server component; the same cached reads as the
// landing page (src/app/site/page.tsx).
import { buildWhatsAppLink } from "@/lib/site-settings/whatsapp";
import { loadFeed } from "@/lib/storefront/feed-data";
import { routeLanding, type FoldedRoute } from "@/lib/storefront/one-view";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { telHref } from "@/lib/storefront/product-enquiry";
import { getShellData } from "@/lib/storefront/shell";
import { FlipFeed } from "./FlipFeed";

export async function FeedRoute({ route }: { route: FoldedRoute }) {
  const landing = routeLanding(route);
  const [shell, feed] = await Promise.all([getShellData(), loadFeed({ tab: landing.tab, offset: 0 })]);
  const to = (path: string) => sitePath(shell.base, path);
  return (
    <FlipFeed
      key={`${route.route}:${feed.tab}`}
      tabs={feed.tabs}
      initialTab={feed.tab}
      initialItems={feed.page.items}
      initialNextOffset={feed.page.nextOffset}
      initialTotal={feed.page.total}
      links={{ visit: to(SITE_ROUTES.visit), call: telHref(shell.settings.contacts.phone), home: to(SITE_ROUTES.home) }}
      hasWhatsApp={buildWhatsAppLink(shell.settings) !== null}
      menu={{ nav: shell.nav, whatsappHref: shell.whatsappHref, social: shell.social, current: shell.homeHref }}
      route={{ overlay: landing.overlay }}
    />
  );
}
