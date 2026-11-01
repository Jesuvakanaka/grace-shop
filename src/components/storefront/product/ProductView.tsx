// ZP-490 product page layout (server component), refreshed in ZP-503 to
// match the flip-feed design.
// Phones: slim sticky top bar (back to the feed, wordmark, Share; the site
// header is left out), the gallery full width with a "1 / N" counter, then
// category, serif name, price or "Ask for price" and tag, colour and size,
// description, "Try it on in store", "You may also like" as a horizontal row,
// and a pinned bottom bar (Enquire on WhatsApp / Ask about restock, Call).
// Desktop (lg): the site header and breadcrumb; thumbnail rail and large
// photo on the left, details in a sticky right column with the inline
// enquiry button, Call us and Share; the related 4-column grid below.
import type { WhatsAppContactSettings } from "@/lib/site-settings/whatsapp";
import type { StoreVisit, TodayLine } from "@/lib/storefront/menu-model";
import { splitOptions, telHref } from "@/lib/storefront/product-enquiry";
import { SITE_ROUTES, sitePath, type SiteBase } from "@/lib/storefront/paths";
import { Badge, type BadgeTone } from "../Badge";
import { Button } from "../Button";
import { Gallery } from "../Gallery";
import { ProductCard, ProductGrid } from "../ProductCard";
import { ASK_FOR_PRICE, formatPriceUsd, toImageData } from "../product";
import { Container, Section } from "../Section";
import { SectionHeader } from "../SectionHeader";
import type { PublicProduct } from "../types";
import { ProductBottomBar } from "./ProductBottomBar";
import { ProductEnquiryButton, ProductEnquiryProvider, ProductOptions } from "./ProductEnquiry";
import { ProductTopBar } from "./ProductTopBar";
import { ProductReviews, RatingSummaryLink, type ProductReviewsData } from "../reviews/ProductReviews";
import { RelatedRow } from "./RelatedRow";
import { ShareButton } from "./ShareButton";
import { StoreVisitRow } from "./StoreVisitRow";

type ProductViewProps = {
  product: PublicProduct;
  /** Owner preview of an unpublished product: shows the banner. */
  preview: boolean;
  /** Absolute public URL (enquiry message and Share), or null. */
  productUrl: string | null;
  related: PublicProduct[];
  contacts: WhatsAppContactSettings & { phone: string | null };
  /** A WhatsApp number is configured (else the Visit Us link replaces the button). */
  hasWhatsApp: boolean;
  showItemNumber: boolean;
  base: SiteBase;
  /** The shop's visit details for "Try it on in store"; null hides the row. */
  visit: StoreVisit | null;
  /** Today's hours for the row's summary (server time, shop time zone). */
  today: TodayLine | null;
  /** ZP-508: approved reviews of the piece and the shop rating; null/absent hides the blocks. */
  reviews?: ProductReviewsData | null;
};

/** Sold out, else Few left, else New (the feed's tag rule). */
function productTag(product: PublicProduct): { label: string; tone: BadgeTone } | null {
  if (product.availability === "SOLD_OUT") return { label: "Sold out", tone: "ink" };
  if (product.availability === "FEW_LEFT") return { label: "Few left", tone: "light" };
  if (product.isNew) return { label: "New", tone: "lime" };
  return null;
}

export function ProductView({
  product,
  preview,
  productUrl,
  related,
  contacts,
  hasWhatsApp,
  showItemNumber,
  base,
  visit,
  today,
  reviews,
}: ProductViewProps) {
  const price = formatPriceUsd(product.priceUsd);
  const tag = productTag(product);
  const colours = splitOptions(product.colours);
  const sizes = splitOptions(product.sizes);
  const tel = telHref(contacts.phone);
  const itemNumber = showItemNumber ? product.itemNumber : undefined;
  const to = (path: string) => sitePath(base, path);
  const homeHref = to(SITE_ROUTES.home);
  const productHref = (slug: string) => to(SITE_ROUTES.product(slug));
  const categoryHref = product.category.slug ? to(SITE_ROUTES.collection(product.category.slug)) : null;
  const shareUrl = productUrl && !preview ? productUrl : null;
  const shareTitle = `${product.name} – VYRA`;
  // Only the WhatsApp fields go to the client.
  const whatsapp: WhatsAppContactSettings = {
    whatsappNumber: contacts.whatsappNumber,
    enquiryTemplate: contacts.enquiryTemplate,
    generalEnquiryMessage: contacts.generalEnquiryMessage,
  };

  return (
    <article aria-labelledby="product-title" className="bg-brand-cream-50 text-brand-ink">
      <ProductTopBar homeHref={homeHref} slug={product.slug} shareUrl={shareUrl} shareTitle={shareTitle} />

      {preview ? (
        <div className="bg-brand-ink text-brand-cream">
          <Container className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="sf-label">Preview, not public</p>
            <p className="text-sm text-brand-cream/80">Anyone with this link can see this page until it expires, 30 minutes after it was made. Enquiry links only work once the piece is published.</p>
          </Container>
        </div>
      ) : null}

      <ProductEnquiryProvider
        contacts={whatsapp}
        productName={product.name}
        productUrl={productUrl}
        availability={product.availability}
        productRef={product.ref}
      >
        <Container className="pb-8 lg:pb-20 lg:pt-8">
          <nav aria-label="Breadcrumb" className="mb-8 hidden lg:block">
            <ol className="sf-label flex flex-wrap items-center gap-x-2 text-brand-ink-soft">
              <li>
                <a href={to(SITE_ROUTES.shop)} className="sf-focus inline-flex min-h-11 items-center rounded-[2px] hover:text-brand-ink">
                  Shop
                </a>
              </li>
              {categoryHref && product.category.name ? (
                <>
                  <li aria-hidden="true">/</li>
                  <li>
                    <a href={categoryHref} className="sf-focus inline-flex min-h-11 items-center rounded-[2px] hover:text-brand-ink">
                      {product.category.name}
                    </a>
                  </li>
                </>
              ) : null}
            </ol>
          </nav>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-[22px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
            {/* Phones: full width under the top bar. */}
            <div className="-mx-4 min-w-0 sm:-mx-6 lg:mx-0">
              <Gallery images={product.images.map(toImageData)} video={product.video} label={product.name} eager counter />
            </div>

            <div className="flex flex-col gap-[22px] lg:sticky lg:top-28 lg:gap-7 lg:self-start">
              <div className="flex flex-col gap-2">
                {product.category.name ? (
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-olive-700">{product.category.name}</p>
                ) : null}
                <h1 id="product-title" className="sf-product-title text-balance text-[2rem] leading-[1.05] lg:text-[2.5rem]">
                  {product.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  {price ? (
                    <p className="text-xl font-medium">
                      <span className="sr-only">Price: </span>
                      {price}
                    </p>
                  ) : (
                    <p className="sf-label text-brand-olive-700">{ASK_FOR_PRICE}</p>
                  )}
                  {tag ? <Badge tone={tag.tone}>{tag.label}</Badge> : null}
                  {itemNumber ? <span className="sf-label text-brand-ink-soft">Ref {itemNumber}</span> : null}
                </div>
                <RatingSummaryLink summary={reviews?.summary ?? null} />
              </div>

              <ProductOptions colours={colours} sizes={sizes} />

              {product.description ? (
                <p className="whitespace-pre-line text-[15px] leading-[1.65] text-brand-ink-soft">{product.description}</p>
              ) : null}

              <ProductReviews data={reviews} />

              {visit ? <StoreVisitRow visit={visit} today={today} /> : null}

              <div className="hidden flex-col gap-4 border-t border-brand-ink/10! pt-6 lg:flex">
                <p className="sf-label text-brand-ink">
                  {hasWhatsApp ? "Available in-store and on WhatsApp" : "Available in-store"}
                </p>
                <ProductEnquiryButton placement="inline" />
                {!hasWhatsApp || tel || shareUrl ? (
                  <div className="grid grid-cols-2 items-start gap-3">
                    {!hasWhatsApp ? (
                      <Button href={to(SITE_ROUTES.visit)} variant="primary" fullWidth className="col-span-2">
                        Visit us
                      </Button>
                    ) : null}
                    {tel ? (
                      <a href={tel} className="sf-focus sf-label-lg inline-flex min-h-11 w-full items-center justify-center rounded-[2px] border border-brand-ink! px-4 py-4 text-brand-ink transition-colors duration-200 hover:bg-brand-ink hover:text-brand-cream">
                        Call us
                      </a>
                    ) : null}
                    {shareUrl ? (
                      <ShareButton url={shareUrl} title={shareTitle} className={tel ? undefined : "col-span-2"} />
                    ) : null}
                  </div>
                ) : null}
              </div>

              <RelatedRow products={related} hrefFor={productHref} className="lg:hidden" />
            </div>
          </div>
        </Container>

        {related.length > 0 ? (
          <Section aria-labelledby="related-title" className="hidden border-t border-brand-ink/10! lg:block">
            <SectionHeader
              id="related-title"
              title="You may also like"
              action={categoryHref ? { label: "View all", href: categoryHref } : undefined}
            />
            <ProductGrid columns={4}>
              {related.map((p) => (
                <li key={p.slug}>
                  <ProductCard product={p} hrefFor={productHref} showCategory={false} />
                </li>
              ))}
            </ProductGrid>
          </Section>
        ) : null}

        {/* Phones: pinned to the bottom while the piece is on screen. */}
        <ProductBottomBar tel={tel} visitHref={to(SITE_ROUTES.visit)} />
      </ProductEnquiryProvider>
    </article>
  );
}
