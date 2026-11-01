// ZP-488: the home page blocks below the hero. Server components; each takes
// the part of the HomeModel it shows, and the page renders a block only when
// its part is not null (empty sections never render).
import Link from "next/link";
import { Wordmark } from "../Brand";
import { Button, buttonClasses } from "../Button";
import { cn } from "../cn";
import { ArrowRightIcon, ChatIcon, ClockIcon, MapPinIcon, QualityIcon, StoreIcon, WhatsAppIcon } from "../icons";
import { ProductCard } from "../ProductCard";
import { Section } from "../Section";
import { SectionHeader } from "../SectionHeader";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import { TrustStrip } from "../TrustStrip";
import type { PublicProduct } from "../types";
import { collectionColumns, type HomeModel } from "./home-model";

type ProductHref = (slug: string) => string;

/** Premium Quality · Visit Our Store · Enquire on WhatsApp (labels from Site settings). */
export function HomeTrustStrip({ labels }: { labels: HomeModel["trustLabels"] }) {
  const icons = [<QualityIcon key="q" />, <StoreIcon key="s" />, <ChatIcon key="c" />];
  return <TrustStrip items={labels.map((title, i) => ({ icon: icons[i], title }))} />;
}

/** Phones: a horizontal scroll row; md and up: a 4-column grid (up to 8). */
export function NewArrivals({
  products,
  viewAllHref,
  productHref,
}: {
  products: PublicProduct[];
  viewAllHref: string;
  productHref: ProductHref;
}) {
  return (
    <Section aria-labelledby="home-new-title">
      <SectionHeader id="home-new-title" title="New arrivals" action={{ label: "View all", href: viewAllHref }} />
      <ul
        role="list"
        className="sf-scroll-x sf-snap-x -mx-4 flex scroll-px-4 gap-3 px-4 pb-2 pt-1 sm:-mx-6 sm:scroll-px-6 sm:gap-5 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:gap-y-12 md:overflow-visible md:px-0 lg:gap-x-6"
      >
        {products.map((p) => (
          <li key={p.slug} className="w-[68%] shrink-0 sm:w-[42%] md:w-auto">
            <ProductCard product={p} hrefFor={productHref} sizes="(min-width: 768px) 25vw, (min-width: 640px) 42vw, 68vw" />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** "EXPLORE OUR COLLECTIONS" between thin rules, as in the mock-up. */
function RuledHeading({ id, children }: { id: string; children: string }) {
  return (
    <div className="mb-8 flex items-center gap-4 sm:gap-6 lg:mb-12">
      <span aria-hidden="true" className="h-px flex-1 bg-brand-ink/25" />
      <h2 id={id} className="sf-label-lg shrink text-center tracking-[0.3em] text-brand-ink">
        {children}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 bg-brand-ink/25" />
    </div>
  );
}

/**
 * Tall 2:3 photo tiles (portrait photos show head to hem, focal point near
 * the top), serif name and "EXPLORE →" in white over an ink scrim (the scrim
 * is at least 70% ink under the text, so white text is AA on any photo).
 */
export function Collections({ tiles }: { tiles: NonNullable<HomeModel["collections"]> }) {
  const cols = collectionColumns(tiles.length);
  return (
    <Section tone="cream-light" aria-labelledby="home-collections-title">
      <RuledHeading id="home-collections-title">Explore our collections</RuledHeading>
      <ul
        role="list"
        className={cn(
          "grid grid-cols-2 gap-3 sm:gap-5 lg:gap-6",
          cols === 3 && "md:grid-cols-3",
          cols === 4 && "md:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {tiles.map((t) => (
          <li key={t.slug}>
            <Link href={t.href} className="sf-card sf-focus group relative block overflow-hidden rounded-[2px]">
              <div className="relative aspect-[2/3] overflow-hidden bg-brand-cream-100">
                <ImageFallback />
                <div className="sf-card-media absolute inset-0">
                  <StorefrontImg
                    image={t.image}
                    decorative
                    sizes={cols === 3 ? "(min-width: 768px) 33vw, 50vw" : "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"}
                    className="object-[50%_15%]"
                  />
                </div>
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-3/4 bg-[linear-gradient(to_top,rgba(30,30,30,0.82)_0%,rgba(30,30,30,0.72)_65%,rgba(30,30,30,0)_100%)]"
                />
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 text-white sm:gap-3 sm:p-6">
                  <span className="font-serif text-2xl font-medium leading-[1.05] text-balance sm:text-3xl lg:text-[2.125rem]">
                    {t.name}
                  </span>
                  <span className="sf-label inline-flex items-center gap-2">
                    Explore
                    <ArrowRightIcon className="sf-motion h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Cream band: VYRA wordmark, WEAR DIFFERENT., an italic serif line, and a lookbook photo. */
export function BrandBand({ band }: { band: HomeModel["brandBand"] }) {
  return (
    <section aria-labelledby="home-brand-title" className="overflow-hidden bg-brand-cream">
      <div className="grid md:grid-cols-2 md:items-stretch">
        <div className="flex flex-col items-center justify-center gap-5 px-4 py-14 text-center sm:px-6 sm:py-16 md:order-1 md:py-24 lg:gap-6">
          <h2 id="home-brand-title">
            <Wordmark className="h-auto w-52 text-brand-ink sm:w-64 lg:w-80" />
          </h2>
          <p className="sf-label-lg tracking-[0.4em] text-brand-ink">{band.tagline}</p>
          <p className="font-serif text-2xl italic leading-snug text-brand-ink sm:text-3xl lg:text-[2.25rem]">{band.line}</p>
          <span aria-hidden="true" className="mt-1 block h-px w-16 bg-brand-ink/30" />
        </div>
        <div className="relative aspect-[4/5] md:order-2 md:aspect-auto md:min-h-[520px]">
          <ImageFallback />
          <StorefrontImg image={band.image} sizes="(min-width: 768px) 50vw, 100vw" className="object-[50%_20%]" />
        </div>
      </div>
    </section>
  );
}

/** Editorial split: a large lookbook photo beside 1 to 4 featured product cards (admin order). */
export function FeaturedEdit({
  featured,
  viewAllHref,
  productHref,
}: {
  featured: NonNullable<HomeModel["featured"]>;
  viewAllHref: string;
  productHref: ProductHref;
}) {
  return (
    <Section aria-labelledby="home-featured-title">
      <SectionHeader
        id="home-featured-title"
        title="The featured edit"
        intro="Pieces we love right now. Come and try them on."
        action={{ label: "View all", href: viewAllHref }}
      />
      <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start lg:gap-12">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[2px] md:sticky md:top-28">
          <ImageFallback />
          <StorefrontImg image={featured.image} sizes="(min-width: 768px) 40vw, 100vw" className="object-[50%_15%]" />
        </div>
        <ul role="list" className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:gap-x-6 lg:gap-y-12">
          {featured.products.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} hrefFor={productHref} sizes="(min-width: 768px) 28vw, 50vw" />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** Address, today's hours, directions and WhatsApp. Each piece shows only when set. */
export function VisitTeaser({ visit, visitHref }: { visit: NonNullable<HomeModel["visit"]>; visitHref: string }) {
  const { address, today, holidayNote, mapHref, whatsappHref } = visit;
  return (
    <Section tone="cream-light" spacing="compact" aria-labelledby="home-visit-title">
      <div>
        <div className="grid gap-8 md:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] md:items-center lg:gap-16">
          <div className="flex flex-col gap-4">
            <SectionHeader id="home-visit-title" title="Visit our store" flush />
            <p className="sf-body text-brand-ink-soft">Come in, take your time and try everything on.</p>
            <Link href={visitHref} className="sf-focus sf-label inline-flex min-h-11 items-center gap-2 self-start text-brand-olive-700 underline-offset-[6px] hover:underline">
              Plan your visit
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-col gap-6">
            {address.length > 0 || today ? (
              <dl className="grid gap-5 border-y border-brand-ink/10! py-6 sm:grid-cols-2">
                {address.length > 0 ? (
                  <div className="flex items-start gap-3">
                    <dt className="mt-0.5 text-brand-olive-700">
                      <MapPinIcon />
                      <span className="sr-only">Address</span>
                    </dt>
                    <dd className="flex flex-col text-brand-ink">
                      <address className="not-italic">
                        {address.map((line) => (
                          <span key={line} className="block">
                            {line}
                          </span>
                        ))}
                      </address>
                    </dd>
                  </div>
                ) : null}
                {today ? (
                  <div className="flex items-start gap-3">
                    <dt className="mt-0.5 text-brand-olive-700">
                      <ClockIcon />
                      <span className="sr-only">Opening hours today</span>
                    </dt>
                    <dd className="flex flex-col gap-1 text-brand-ink">
                      <span>
                        <span className="sf-label text-brand-ink-soft">Today, {today.dayLabel}</span>
                        <span className="block text-lg">{today.open ? `Today ${today.text}` : "Closed today"}</span>
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {holidayNote ? (
              <p className="-mt-2 text-sm text-brand-ink-soft">{holidayNote}</p>
            ) : null}
            {mapHref || whatsappHref ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {mapHref ? (
                  <Button href={mapHref} variant="ghost" arrow target="_blank" rel="noopener noreferrer">
                    Get directions
                    <span className="sr-only"> (opens Google Maps in a new tab)</span>
                  </Button>
                ) : null}
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    className={buttonClasses("primary")}
                  >
                    <WhatsAppIcon className="h-5 w-5 shrink-0" />
                    <span>Enquire on WhatsApp</span>
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}
