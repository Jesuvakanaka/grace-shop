// ZP-490: the product page layout (server component). Phones: one stacked
// column (gallery, name, price, availability, chips, description, enquiry,
// "You may also like") with the enquiry button pinned to the bottom of the
// screen until its place in the page scrolls into view. Desktop: thumbnail
// rail and large photo on the left, details in a sticky right column.
import type { WhatsAppContactSettings } from "@/lib/site-settings/whatsapp";
import { splitOptions, telHref } from "@/lib/storefront/product-enquiry";
import { SITE_ROUTES, sitePath, type SiteBase } from "@/lib/storefront/paths";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Gallery } from "../Gallery";
import { ProductCard, ProductGrid } from "../ProductCard";
import { ASK_FOR_PRICE, availabilityLabel, formatPriceUsd, toImageData } from "../product";
import { Container, Section } from "../Section";
import { SectionHeader } from "../SectionHeader";
import type { PublicProduct } from "../types";
import { ProductEnquiryButton, ProductEnquiryProvider, ProductOptions } from "./ProductEnquiry";
import { ShareButton } from "./ShareButton";

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
};

export function ProductView({
  product,
  preview,
  productUrl,
  related,
  contacts,
  hasWhatsApp,
  showItemNumber,
  base,
}: ProductViewProps) {
  const price = formatPriceUsd(product.priceUsd);
  const stockLabel = availabilityLabel(product.availability);
  const soldOut = product.availability === "SOLD_OUT";
  const colours = splitOptions(product.colours);
  const sizes = splitOptions(product.sizes);
  const tel = telHref(contacts.phone);
  const itemNumber = showItemNumber ? product.itemNumber : undefined;
  const to = (path: string) => sitePath(base, path);
  const categoryHref = product.category.slug ? to(SITE_ROUTES.collection(product.category.slug)) : null;
  // Only the WhatsApp fields go to the client.
  const whatsapp: WhatsAppContactSettings = {
    whatsappNumber: contacts.whatsappNumber,
    enquiryTemplate: contacts.enquiryTemplate,
    generalEnquiryMessage: contacts.generalEnquiryMessage,
  };

  return (
    <article aria-labelledby="product-title" className="bg-brand-cream text-brand-ink">
      {preview ? (
        <div className="bg-brand-ink text-brand-cream">
          <Container className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="sf-label">Preview, not public</p>
            <p className="text-sm text-brand-cream/80">Only you can see this page. The link expires 30 minutes after it was made.</p>
          </Container>
        </div>
      ) : null}

      <ProductEnquiryProvider
        contacts={whatsapp}
        productName={product.name}
        productUrl={productUrl}
        availability={product.availability}
      >
        <Container className="pb-10 pt-4 lg:pb-20 lg:pt-8">
          <nav aria-label="Breadcrumb" className="mb-4 lg:mb-8">
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

          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
            <Gallery images={product.images.map(toImageData)} label={product.name} eager />

            <div className="flex flex-col gap-7 lg:sticky lg:top-28 lg:self-start">
              <div className="flex flex-col gap-3">
                <h1 id="product-title" className="sf-product-title text-balance lg:text-[2.5rem]">
                  {product.name}
                </h1>
                {price ? (
                  <p className="sf-price">
                    <span className="sr-only">Price: </span>
                    {price}
                  </p>
                ) : (
                  <p className="sf-label text-brand-olive-700">{ASK_FOR_PRICE}</p>
                )}
                {stockLabel || itemNumber ? (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {stockLabel ? <Badge tone={soldOut ? "ink" : "light"}>{stockLabel}</Badge> : null}
                    {itemNumber ? <span className="sf-label text-brand-ink-soft">Ref {itemNumber}</span> : null}
                  </div>
                ) : null}
              </div>

              <ProductOptions colours={colours} sizes={sizes} />

              {product.description ? (
                <p className="sf-body whitespace-pre-line text-brand-ink-soft">{product.description}</p>
              ) : null}

              <div className="flex flex-col gap-4 border-t border-brand-ink/10! pt-6">
                <p className="sf-label text-brand-ink">
                  {hasWhatsApp ? "Available in-store and on WhatsApp" : "Available in-store"}
                </p>
                <ProductEnquiryButton placement="inline" className="hidden lg:block" />
                {!hasWhatsApp || tel || productUrl ? (
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
                    {productUrl ? (
                      <ShareButton url={productUrl} title={`${product.name} – VYRA`} className={tel ? undefined : "col-span-2"} />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Container>

        {/* Phones: pinned to the bottom while the details above are on screen; it then
            settles here, before "You may also like", so it never covers the footer. */}
        <ProductEnquiryButton placement="sticky" />

        {related.length > 0 ? (
          <Section aria-labelledby="related-title" className="border-t border-brand-ink/10!">
            <SectionHeader
              id="related-title"
              title="You may also like"
              action={categoryHref ? { label: "View all", href: categoryHref } : undefined}
            />
            <ProductGrid columns={4}>
              {related.map((p) => (
                <li key={p.slug}>
                  <ProductCard product={p} hrefFor={(slug) => to(SITE_ROUTES.product(slug))} showCategory={false} />
                </li>
              ))}
            </ProductGrid>
          </Section>
        ) : null}
      </ProductEnquiryProvider>
    </article>
  );
}
