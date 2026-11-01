import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { ProductView } from "@/components/storefront/product/ProductView";
import { hostRoutingConfigFromEnv } from "@/lib/host-routing";
import { buildWhatsAppLink, getPublicSiteSettings } from "@/lib/site-settings/public";
import {
  getProductPreviewCandidate,
  getPublishedProductBySlug,
  getReviewsIndex,
  listPublishedProducts,
} from "@/lib/storefront";
import { buildStoreVisit, todayLine } from "@/lib/storefront/menu-model";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { decideProductRoute, previewTokenFrom, productAbsoluteUrl } from "@/lib/storefront/product-route";
import { pickRelated } from "@/lib/storefront/related";
import { jsonLdScript, productReviewsJsonLd } from "@/lib/reviews/structured-data";
import { getSiteBase } from "@/lib/storefront/site-base";
import { VYRA_TAGLINE } from "@/lib/storefront/shell-model";
import { verifyPreviewTokenFor } from "@/lib/website/preview-token";

// ZP-490: /p/<slug> (served at /site/p/<slug> on the admin/UAT host).
// Decision (src/lib/storefront/product-route.ts): public product -> page;
// old slug -> 308 to the current slug; unpublished/unknown -> 404; an
// unpublished product with a valid preview token for exactly that product ->
// owner preview (banner, noindex, no-referrer). The proxy adds
// `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` to
// every product URL carrying ?preview= (a page cannot set response headers).
// See docs/storefront/product-page.md.

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
  return {
    title: product.name,
    description: describe(product.name, product.description),
    openGraph: {
      title: `${product.name} – VYRA`,
      description: describe(product.name, product.description),
      url: url ?? undefined,
      images: image && origin ? [{ url: `${origin}${image.url}`, alt: image.alt }] : undefined,
    },
  };
}

export default async function ProductPage(props: Props) {
  const { decision, settings } = await read(props);
  const base = await getSiteBase();

  if (decision.kind === "redirect") permanentRedirect(sitePath(base, SITE_ROUTES.product(decision.slug)));
  if (decision.kind === "not-found") notFound();

  const { product } = decision;
  const preview = decision.kind === "preview";
  // ZP-503: "Try it on in store". The page renders per request, so "today" is current.
  const visit = buildStoreVisit(settings);
  const [url, related, reviewsIndex] = await Promise.all([
    absoluteUrl(product.slug),
    product.category.slug
      ? listPublishedProducts({ categorySlug: product.category.slug, pageSize: 48 }).then((page) =>
          pickRelated(page.items, product),
        )
      : Promise.resolve([]),
    // ZP-508: approved reviews (cached entry); none for an owner preview.
    preview ? Promise.resolve(null) : getReviewsIndex(),
  ]);
  const pieceReviews = reviewsIndex?.products[product.slug] ?? null;
  const reviews = reviewsIndex
    ? { summary: pieceReviews?.summary ?? null, reviews: pieceReviews?.reviews ?? [], shop: reviewsIndex.shop }
    : null;
  const origin = url ? new URL(url).origin : null;
  const jsonLd = productReviewsJsonLd({
    name: product.name,
    url,
    image: origin && product.images[0] ? `${origin}${product.images[0].url}` : null,
    summary: reviews?.summary ?? null,
    reviews: reviews?.reviews ?? [],
  });

  return (
    <>
    {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} /> : null}
    <ProductView
      product={product}
      preview={preview}
      productUrl={url}
      related={related}
      contacts={settings.contacts}
      hasWhatsApp={buildWhatsAppLink(settings) !== null}
      showItemNumber={settings.showItemNumber}
      base={base}
      visit={visit}
      today={visit ? todayLine(visit.hours, new Date()) : null}
      reviews={reviews}
    />
    </>
  );
}
