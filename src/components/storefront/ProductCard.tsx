import Link from "next/link";
import { Badge } from "./Badge";
import { cn } from "./cn";
import { ASK_FOR_PRICE, availabilityLabel, cardImages, formatPriceUsd, productHref } from "./product";
import { ImageFrame, StorefrontImg } from "./StorefrontImage";
import type { PublicProduct } from "./types";

export type ProductCardProps = {
  /** The public product DTO (ZP-484 shape, see types.ts). */
  product: PublicProduct;
  /** Builds the link from the slug. Default: productHref → `/site/p/<slug>`. */
  hrefFor?: (slug: string) => string;
  /** Show the category name above the product name. */
  showCategory?: boolean;
  /** Above the fold: load the photo eagerly. */
  eager?: boolean;
  sizes?: string;
  className?: string;
};

/**
 * Portrait 4:5 card. The whole card is one link. Everything shown comes from
 * the DTO: first photo, second photo on desktop hover, NEW badge (isNew, not
 * when sold out), "Few left" / "Sold out" badges (availability), and the price
 * or "ASK FOR PRICE" (priceUsd).
 */
export function ProductCard({
  product,
  hrefFor = productHref,
  showCategory = true,
  eager = false,
  sizes = "(min-width: 1024px) 280px, 50vw",
  className,
}: ProductCardProps) {
  const { primary, hover } = cardImages(product);
  const soldOut = product.availability === "SOLD_OUT";
  const stockLabel = availabilityLabel(product.availability);
  const price = formatPriceUsd(product.priceUsd);
  const showNew = product.isNew && !soldOut;
  return (
    <Link href={hrefFor(product.slug)} className={cn("sf-card sf-focus group relative block rounded-[2px]", className)}>
      <ImageFrame ratio="4 / 5" className="rounded-[2px]">
        {primary ? (
          <div className="sf-card-media absolute inset-0">
            <StorefrontImg image={primary} eager={eager} sizes={sizes} className={cn(soldOut && "grayscale-[35%]")} />
            {hover ? <StorefrontImg image={hover} sizes={sizes} decorative className="sf-card-alt" /> : null}
          </div>
        ) : null}
        {showNew || stockLabel ? (
          <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
            {showNew ? <Badge tone="lime">New</Badge> : null}
            {stockLabel ? <Badge tone={soldOut ? "ink" : "light"}>{stockLabel}</Badge> : null}
          </div>
        ) : null}
      </ImageFrame>
      <div className="flex flex-col gap-1.5 pt-3.5 sm:pt-4">
        {showCategory && product.category.name ? (
          <span className="sf-label text-brand-ink-soft">{product.category.name}</span>
        ) : null}
        <h3 className="line-clamp-2 font-serif text-xl font-medium leading-[1.15] text-brand-ink sm:text-[1.375rem]">
          {product.name}
        </h3>
        {price ? (
          <p className="sf-price text-brand-ink">
            <span className="sr-only">Price: </span>
            {price}
          </p>
        ) : (
          <p className="sf-label pt-1 text-brand-olive-700">{ASK_FOR_PRICE}</p>
        )}
      </div>
    </Link>
  );
}

/** Responsive product grid: 2 columns on phones, then 3 or 4. */
export function ProductGrid({
  columns = 4,
  className,
  children,
}: {
  columns?: 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}) {
  const cols = { 2: "lg:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-3 lg:grid-cols-4" }[columns];
  return (
    <ul role="list" className={cn("grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:gap-x-6 lg:gap-y-14", cols, className)}>
      {children}
    </ul>
  );
}
