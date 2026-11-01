import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  Badge,
  Button,
  CategoryTile,
  ColourBlock,
  Container,
  EmptyState,
  EnquiryButton,
  ErrorState,
  FilterBar,
  Gallery,
  Hero,
  NotFoundState,
  ProductCard,
  ProductGrid,
  Section,
  SectionHeader,
  TrustStrip,
} from "@/components/storefront";
import { ClockIcon, MapPinIcon } from "@/components/storefront/icons";
import { ASK_FOR_PRICE, formatPriceUsd, toImageData } from "@/components/storefront/product";
import { ImageFrame, StorefrontImg } from "@/components/storefront/StorefrontImage";
import {
  WHATSAPP_HREF,
  categories,
  editImage,
  featured,
  filterChips,
  hero,
  newArrivals,
  products,
  related,
  sortOptions,
  visitImage,
} from "./preview-data";
import { storefrontPreviewEnabled } from "./preview-gate";

// ZP-481: static design preview of the VYRA storefront (home, collection,
// product page, states) built from src/components/storefront with placeholder
// data. Only served when GRACE_STOREFRONT_PREVIEW=true; never indexed.
export const metadata: Metadata = {
  title: "Design preview",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

/** In-page jump links to the preview sections (the shell nav goes to the real pages). */
const sections = [
  { label: "Home", href: "#home" },
  { label: "New arrivals", href: "#new-arrivals" },
  { label: "Categories", href: "#categories" },
  { label: "Visit", href: "#visit" },
  { label: "Collection page", href: "#collection" },
  { label: "Product page", href: "#product" },
  { label: "States", href: "#states" },
];

function PreviewDivider({ id, label }: { id?: string; label: string }) {
  return (
    <div id={id} className="scroll-mt-16 bg-brand-ink py-3 text-center lg:scroll-mt-20">
      <p className="sf-label text-brand-cream">Design preview · {label}</p>
    </div>
  );
}

/** Preview links every card to the product section below. */
const toProductSection = () => "#product";

/** "XS, S, M" -> ["XS", "S", "M"] (the DTO keeps sizes and colours as free text). */
function splitList(value: string | null): string[] {
  return (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

function Chip({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <li
      className={
        active
          ? "sf-label inline-flex min-h-11 min-w-11 items-center justify-center rounded-[2px] border border-brand-ink! bg-brand-ink px-3 text-brand-cream"
          : "sf-label inline-flex min-h-11 min-w-11 items-center justify-center rounded-[2px] border border-brand-ink/20! bg-white px-3 text-brand-ink"
      }
    >
      {children}
    </li>
  );
}

export default async function StorefrontDesignPreview() {
  await connection(); // read the env at request time, not at build
  if (!storefrontPreviewEnabled()) notFound();

  const featuredPrice = formatPriceUsd(featured.priceUsd);

  // ZP-487: the real storefront shell (src/app/site/layout.tsx) now draws the
  // skip link, header and footer around this page.
  return (
    <div className="bg-brand-cream text-brand-ink">
      <nav aria-label="Design preview sections" className="border-b border-brand-ink/10! bg-brand-cream-100">
        <ul className="sf-scroll-x mx-auto flex max-w-[1200px] gap-1 px-2 sm:px-4 lg:px-8">
          {sections.map((s) => (
            <li key={s.href} className="shrink-0">
              <a
                href={s.href}
                className="sf-focus sf-label inline-flex min-h-11 items-center rounded-[2px] px-3 text-brand-ink-soft hover:text-brand-ink"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* ------------------------------------------------------------ HOME */}
      <div id="home" className="scroll-mt-20">
        {/* Portrait lookbook photo: the split layout shows the whole look. */}
        <Hero
          layout="split"
          title="Style your way"
          subline="Premium fashion. Modern you."
          eyebrow="Wear different."
          primary={{ label: "Shop the collection", href: "#collection" }}
          secondary={{ label: "Visit us", href: "#visit" }}
          image={hero}
          className="border-t-0"
        />
      </div>

      <TrustStrip />

      <Section id="new-arrivals" className="scroll-mt-16 lg:scroll-mt-20" aria-labelledby="new-arrivals-title">
        <SectionHeader
          id="new-arrivals-title"
          title="New arrivals"
          intro="Fresh in this week. Come and try them on, or ask us about your size."
          action={{ label: "View all", href: "#collection" }}
        />
        <ul
          role="list"
          className="sf-scroll-x sf-snap-x -mx-4 flex scroll-px-4 gap-3 px-4 pb-2 pt-1 sm:scroll-px-6 sm:-mx-6 sm:gap-5 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 lg:gap-6"
        >
          {newArrivals.map((p) => (
            <li key={p.slug} className="w-[68%] shrink-0 sm:w-[42%] md:w-auto">
              <ProductCard product={p} hrefFor={toProductSection} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="categories" tone="cream-light" className="scroll-mt-16 lg:scroll-mt-20" aria-labelledby="categories-title">
        <SectionHeader id="categories-title" title="Shop by category" />
        <ul role="list" className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {categories.map((c) => (
            <li key={c.name}>
              <CategoryTile name={c.name} meta={c.meta} href="#collection" image={c.image} />
            </li>
          ))}
        </ul>
      </Section>

      <ColourBlock
        id="about"
        eyebrow="Be bold. Be you."
        statement="Confidence in every stitch"
        action={{ label: "Our story", href: "#visit" }}
        className="scroll-mt-16 lg:scroll-mt-20"
      />

      <Hero
        as="h2"
        layout="split"
        reverse
        eager={false}
        title="Elevate your style"
        eyebrow="The featured edit"
        subline="Pleats, prints and olive tones. Wear it together, or let one piece do the talking."
        primary={{ label: "Shop the edit", href: "#collection" }}
        image={editImage}
      />

      <Section id="visit" className="scroll-mt-16 lg:scroll-mt-20" aria-labelledby="visit-title">
        <div className="grid items-center gap-10 md:grid-cols-2 lg:gap-20">
          <ImageFrame ratio="4 / 5" className="rounded-[2px]">
            <StorefrontImg image={visitImage} sizes="(min-width: 768px) 50vw, 100vw" />
          </ImageFrame>
          <div className="flex flex-col gap-6">
            <SectionHeader id="visit-title" title="Visit our store" flush />
            <p className="sf-body text-brand-ink-soft">
              Come in, take your time and try everything on. We will help you find the fit, the colour and the look
              that feels like you.
            </p>
            <dl className="flex flex-col gap-4 border-y border-brand-ink/10! py-6">
              <div className="flex items-start gap-4">
                <dt className="text-brand-olive-700">
                  <MapPinIcon />
                  <span className="sr-only">Address</span>
                </dt>
                <dd className="text-brand-ink">Shop address to follow · City</dd>
              </div>
              <div className="flex items-start gap-4">
                <dt className="text-brand-olive-700">
                  <ClockIcon />
                  <span className="sr-only">Opening hours</span>
                </dt>
                <dd className="text-brand-ink">Mon–Sat 9:00–18:00 · Sun closed</dd>
              </div>
            </dl>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="#visit" variant="primary" arrow>
                Get directions
              </Button>
              <Button href={WHATSAPP_HREF} variant="ghost">
                Ask us anything
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ COLLECTION */}
      <PreviewDivider id="collection" label="Collection page" />
      <Section aria-labelledby="collection-title" className="pt-10 sm:pt-12 lg:pt-16">
        <nav aria-label="Breadcrumb (collection)" className="mb-6">
          <ol className="sf-label flex gap-2 text-brand-ink-soft">
            <li>
              <Link href="#home" className="sf-focus inline-flex min-h-11 items-center rounded-[2px] hover:text-brand-ink">
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="inline-flex min-h-11 items-center">
              /
            </li>
            <li className="inline-flex min-h-11 items-center text-brand-ink" aria-current="page">
              Shop
            </li>
          </ol>
        </nav>
        <SectionHeader
          as="h2"
          id="collection-title"
          title="The collection"
          intro="Every piece in store now. Tap one to see more photos, or ask us about it on WhatsApp."
        />
        <FilterBar chips={filterChips} sortOptions={sortOptions} resultLabel={`${products.length} pieces`} className="mb-8 lg:mb-12" />
        <ProductGrid columns={4}>
          {products.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} hrefFor={toProductSection} />
            </li>
          ))}
        </ProductGrid>
        <div className="mt-12 flex justify-center lg:mt-16">
          <Button variant="ghost">Show more</Button>
        </div>
      </Section>

      {/* --------------------------------------------------------- PRODUCT */}
      <PreviewDivider id="product" label="Product page" />
      <article aria-labelledby="product-title" className="bg-brand-cream">
        <Container className="pt-6 lg:pt-12">
          <nav aria-label="Breadcrumb (product)" className="mb-4 lg:mb-8">
            <ol className="sf-label flex flex-wrap gap-2 text-brand-ink-soft">
              <li>
                <Link href="#home" className="sf-focus inline-flex min-h-11 items-center rounded-[2px] hover:text-brand-ink">
                  Home
                </Link>
              </li>
              <li aria-hidden="true" className="inline-flex min-h-11 items-center">
                /
              </li>
              <li>
                <Link href="#collection" className="sf-focus inline-flex min-h-11 items-center rounded-[2px] hover:text-brand-ink">
                  {featured.category.name}
                </Link>
              </li>
            </ol>
          </nav>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
            <Gallery images={featured.images.map(toImageData)} label={featured.name} eager={false} />
            <div className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  {featured.isNew ? <Badge tone="lime">New</Badge> : null}
                  <span className="sf-label text-brand-ink-soft">{featured.category.name}</span>
                </div>
                <h2 id="product-title" className="sf-product-title text-balance">
                  {featured.name}
                </h2>
                {featuredPrice ? (
                  <p className="sf-price">{featuredPrice}</p>
                ) : (
                  <p className="sf-label text-brand-olive-700">{ASK_FOR_PRICE}</p>
                )}
              </div>
              {featured.description ? <p className="sf-body text-brand-ink-soft">{featured.description}</p> : null}
              {splitList(featured.sizes).length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="sf-label text-brand-ink">Sizes in store</h3>
                  <ul role="list" className="flex flex-wrap gap-2">
                    {splitList(featured.sizes).map((size) => (
                      <Chip key={size}>{size}</Chip>
                    ))}
                  </ul>
                </div>
              ) : null}
              {splitList(featured.colours).length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="sf-label text-brand-ink">Colours</h3>
                  <ul role="list" className="flex flex-wrap gap-2">
                    {splitList(featured.colours).map((colour) => (
                      <Chip key={colour}>{colour}</Chip>
                    ))}
                  </ul>
                </div>
              ) : null}
              <EnquiryButton href={WHATSAPP_HREF} className="hidden lg:block" />
              <p className="text-sm text-brand-ink-soft">
                Ask us about sizes and fit, or reserve it to try on in store.
              </p>
              <div className="divide-y divide-brand-ink/10! border-y border-brand-ink/10!">
                {[
                  ["Fabric and care", "Soft viscose blend. Cool hand wash, dry flat, warm iron."],
                  ["Fit", "True to size with a relaxed waist. Our model is 1.75 m and wears S."],
                  ["Try it on in store", "Message us and we will keep your size ready for you."],
                ].map(([title, body]) => (
                  <details key={title} className="group">
                    <summary className="sf-focus sf-label flex min-h-14 cursor-pointer list-none items-center justify-between rounded-[2px] text-brand-ink [&::-webkit-details-marker]:hidden">
                      {title}
                      <span aria-hidden="true" className="text-lg font-light leading-none transition-transform duration-200 group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="sf-body pb-5 text-brand-ink-soft">{body}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </Container>

        <Section aria-labelledby="related-title">
          <SectionHeader id="related-title" title="You may also like" as="h3" action={{ label: "View all", href: "#collection" }} />
          <ProductGrid columns={4}>
            {related.map((p) => (
              <li key={p.slug}>
                <ProductCard product={p} hrefFor={toProductSection} />
              </li>
            ))}
          </ProductGrid>
        </Section>
        <EnquiryButton href={WHATSAPP_HREF} placement="sticky" />
      </article>

      {/* ---------------------------------------------------------- STATES */}
      <PreviewDivider id="states" label="Empty, error and 404 states" />
      <div className="grid divide-y divide-brand-ink/10! bg-brand-cream lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <EmptyState
          title="No pieces match yet"
          message="Try another category, or ask us on WhatsApp. New pieces arrive often."
          action={{ label: "Clear filters", href: "#collection" }}
        />
        <ErrorState action={{ label: "Try again", href: "#home" }} />
        <NotFoundState as="h2" action={{ label: "See new arrivals", href: "#new-arrivals" }} />
      </div>
    </div>
  );
}
