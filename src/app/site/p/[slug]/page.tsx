import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { FlipFeed } from "@/components/storefront/feed/FlipFeed";
import { ASK_FOR_PRICE, formatPriceUsd } from "@/components/storefront/product";
import { hostRoutingConfigFromEnv } from "@/lib/host-routing";
import { jsonLdScript, productReviewsJsonLd } from "@/lib/reviews/structured-data";
import { buildWhatsAppLink, getPublicSiteSettings } from "@/lib/site-settings/public";
import { getProductPreviewCandidate, getPublishedProductBySlug, getReviewsIndex } from "@/lib/storefront";
import { FEED_NEW_TAB, FEED_NEW_TAB_LABEL } from "@/lib/storefront/feed";
import { feedItemFor, loadFeed } from "@/lib/storefront/feed-data";
import { buildSheetExtras } from "@/lib/storefront/feed-sheet";
import { buildStoreVisit } from "@/lib/storefront/menu-model";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { telHref } from "@/lib/storefront/product-enquiry";
import { withLandingItem } from "@/lib/storefront/product-landing";
import { decideProductRoute, previewTokenFrom, productAbsoluteUrl } from "@/lib/storefront/product-route";
import { getShellData } from "@/lib/storefront/shell";
import { VYRA_TAGLINE } from "@/lib/storefront/shell-model";
import { getSiteBase } from "@/lib/storefront/site-base";
import { verifyPreviewTokenFor } from "@/lib/website/preview-token";

// ZP-490 / ZP-512: /p/<slug> (served at /site/p/<slug> on the admin/UAT host).
// The separate product page is gone (owner, ZP-512): this URL renders the
// flip feed on that look with its details sheet open, exactly like
// `/?d=<slug>` (after hydration the address becomes the feed's, the look
// behind the sheet). It stays the piece's shareable, canonical URL with a
// per-piece server render: title, description, canonical, Open Graph /
// Twitter image from the primary photo, JSON-LD Product (+ AggregateRating
// only for approved reviews), and the name / price / description in the HTML.
//
// Decision (src/lib/storefront/product-route.ts): public product -> feed;
// old slug -> 308 to the current slug; unpublished/unknown -> 404; an
// unpublished product with a valid preview token for exactly that product ->
// owner preview (just that look, its sheet open, banner, noindex,
// no-referrer). The proxy adds `Referrer-Policy: no-referrer` and
// `Cache-Control: private, no-store` to every product URL carrying ?preview=.
// See docs/storefront/feed.md and docs/storefront/product-page.md.

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One decision per request, shared by generateMetadata and the page. */
const resolve = cache(async (slug: string, previewToken: string | null) => {
  const settings = await getPublicSiteSettings();
  const includeItemNumber = settings.showItemNumber;
  const decision = await decideProductRoute(
    { slug, previewToken },
    {
      lookupPublished: (s) => getPublishedProductBySlug(s, { includeItemNumber }),
      loadPreviewCandidate: (s) => getProductPreviewCandidate(s, { includeItemNumber }),
      verifyPreviewTokenFor: (token, productId) => verifyPreviewTokenFor(token, productId),
    },
  );
  return { decision, settings };
});

async function read(props: Props) {
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  return resolve(slug, previewTokenFrom(query.preview));
}

async function absoluteUrl(slug: string): Promise<string | null> {
  const h = await headers();
  return productAbsoluteUrl({ slug, storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts, host: h.get("host") });
}

function describe(name: string, description: string | null): string {
  const text = description?.replace(/\s+/g, " ").trim();
  if (!text) return `${name} at VYRA. ${VYRA_TAGLINE}`;
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { decision } = await read(props);
  if (decision.kind === "preview") {
    return {
      title: `Preview: ${decision.product.name}`,
      robots: { index: false, follow: false, nocache: true },
      // Belt and braces with the proxy's Referrer-Policy header.
      referrer: "no-referrer",
    };
  }
  if (decision.kind !== "product") return {};
  const { product } = decision;
  const url = await absoluteUrl(product.slug);
  const origin = url ? new URL(url).origin : null;
  const image = product.images[0];
  const description = describe(product.name, product.description);
  const images = image && origin ? [{ url: `${origin}${image.url}`, alt: image.alt }] : undefined;
  return {
    title: product.name,
    description,
    // The piece's own URL stays canonical (shared links, previews), not the feed's.
    alternates: url ? { canonical: url } : undefined,
    openGraph: { title: `${product.name} – VYRA`, description, url: url ?? undefined, images, type: "website" },
    twitter: { card: images ? "summary_large_image" : "summary", title: `${product.name} – VYRA`, description, images },
  };
}

export default async function ProductPage(props: Props) {
  const { decision, settings } = await read(props);
  const base = await getSiteBase();

  if (decision.kind === "redirect") permanentRedirect(sitePath(base, SITE_ROUTES.product(decision.slug)));
  if (decision.kind === "not-found") notFound();

  const { product } = decision;
  const preview = decision.kind === "preview";
  const to = (path: string) => sitePath(base, path);
  const [shell, url, reviewsIndex] = await Promise.all([
    getShellData(),
    absoluteUrl(product.slug),
    // ZP-508: approved reviews (cached entry); none for an owner preview.
    preview ? Promise.resolve(null) : getReviewsIndex(),
  ]);

  // The feed: New in, loaded through this look (it is always in it); an owner preview shows just this look.
  const feed = preview
    ? {
        tab: FEED_NEW_TAB,
        tabs: [{ id: FEED_NEW_TAB, label: FEED_NEW_TAB_LABEL, count: 1 }],
        items: [await feedItemFor(product, { preview: true })],
        nextOffset: null,
        total: 1,
      }
    : await (async () => {
        const { tab, tabs, page } = await loadFeed({ tab: FEED_NEW_TAB, offset: 0, through: product.slug });
        const items = page.items.some((p) => p.slug === product.slug)
          ? page.items
          : withLandingItem(page.items, await feedItemFor(product, { preview: false }));
        return { tab, tabs, items, nextOffset: page.nextOffset, total: Math.max(page.total, items.length) };
      })();
  // The owner preview's sheet details come from here (the sheet's server action only knows published pieces).
  const previewExtras = preview
    ? buildSheetExtras(product, {
        contacts: settings.contacts,
        reviews: null,
        shop: null,
        visit: buildStoreVisit(settings),
        now: new Date(),
        defaultSizeChart: settings.buying.sizeChart,
        buying: { holdHours: settings.buying.holdHours, paymentMethods: settings.buying.paymentMethods },
      })
    : null;

  const pieceReviews = reviewsIndex?.products[product.slug] ?? null;
  const origin = url ? new URL(url).origin : null;
  const jsonLd = preview
    ? null
    : productReviewsJsonLd({
        name: product.name,
        url,
        image: origin && product.images[0] ? `${origin}${product.images[0].url}` : null,
        summary: pieceReviews?.summary ?? null,
        reviews: pieceReviews?.reviews ?? [],
      });
  const price = formatPriceUsd(product.priceUsd) ?? ASK_FOR_PRICE;

  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} /> : null}
      {/* The piece in the HTML (crawlers, link previews, no JS); the sheet shows the same once hydrated. */}
      <section aria-labelledby="piece-summary-title" className="sr-only">
        <h2 id="piece-summary-title">{product.name}</h2>
        {product.category.name ? <p>{product.category.name}</p> : null}
        <p>{price}</p>
        {product.description ? <p>{product.description}</p> : null}
      </section>
      {preview ? (
        // A slim strip over the top of the feed; taps go through to the top bar under it.
        <p
          role="note"
          className="pointer-events-none fixed inset-x-0 top-0 z-40 m-0 truncate bg-brand-ink/90 px-3 py-1 text-center text-[11px] leading-tight text-brand-cream"
        >
          <span className="font-semibold uppercase tracking-[0.12em]">Preview, not public</span> · link valid 30 min · enquiry links
          work once published
        </p>
      ) : null}
      <FlipFeed
        key={`p:${product.slug}:${preview ? "preview" : "public"}`}
        tabs={feed.tabs}
        initialTab={feed.tab}
        initialItems={feed.items}
        initialNextOffset={feed.nextOffset}
        initialTotal={feed.total}
        links={{ visit: to(SITE_ROUTES.visit), call: telHref(settings.contacts.phone), home: to(SITE_ROUTES.home) }}
        hasWhatsApp={buildWhatsAppLink(settings) !== null}
        menu={{ nav: shell.nav, whatsappHref: shell.whatsappHref, social: shell.social, current: shell.homeHref }}
        landing={{ slug: product.slug, mode: preview ? "preview" : "product", extras: previewExtras }}
      />
    </>
  );
}
