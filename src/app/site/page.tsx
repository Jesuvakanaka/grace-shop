import { FlipFeed } from "@/components/storefront/feed/FlipFeed";
import { buildWhatsAppLink } from "@/lib/site-settings/whatsapp";
import { FEED_TAB_PARAM } from "@/lib/storefront/feed";
import { loadFeed } from "@/lib/storefront/feed-data";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { telHref } from "@/lib/storefront/product-enquiry";
import { getShellData } from "@/lib/storefront/shell";

// ZP-500: the VYRA landing page is a full-screen flip feed: one published
// piece per slide (docs/storefront/feed.md). The feed marks itself
// (data-feed-page), so the frame is full screen with no top bar. The title is the layout default
// ("VYRA – Wear Different."); noindex comes from the layout.
//
// The first FEED_PAGE_SIZE (12) pieces of the tab in ?c= are rendered on the
// server, so the first slide (and its eager, high-priority photo) and real
// <a href> links to each piece (/p/<slug>) are in the HTML. The rest loads on
// demand through a server action reading the same cached catalogue.
// ZP-514: every other storefront address folds into this feed (FeedRoute).
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StorefrontHome({ searchParams }: Props) {
  const [query, shell] = await Promise.all([searchParams, getShellData()]);
  const { tab, tabs, page } = await loadFeed({ tab: query[FEED_TAB_PARAM], offset: 0 });
  const to = (path: string) => sitePath(shell.base, path);

  return (
    <FlipFeed
      // A different tab from the server starts a fresh feed.
      key={tab}
      tabs={tabs}
      initialTab={tab}
      initialItems={page.items}
      initialNextOffset={page.nextOffset}
      initialTotal={page.total}
      // ZP-510: Call on the rail and in the details sheet (hidden without a phone number).
      links={{ visit: to(SITE_ROUTES.visit), call: telHref(shell.settings.contacts.phone), home: to(SITE_ROUTES.home) }}
      hasWhatsApp={buildWhatsAppLink(shell.settings) !== null}
      menu={{ nav: shell.nav, whatsappHref: shell.whatsappHref, social: shell.social, current: shell.homeHref }}
    />
  );
}
