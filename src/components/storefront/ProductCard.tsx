import Link from "next/link";
import { Badge } from "./Badge";
import { cn } from "./cn";
import { ImageFrame, StorefrontImg } from "./StorefrontImage";
import type { StockState, StorefrontImageData } from "./types";

export type ProductCardProps = {
  name: string;
  href: string;
  image: StorefrontImageData;
  /** Second photo, shown on desktop hover. */
  hoverImage?: StorefrontImageData;
  /** Pre-formatted price ("$45"). Null or missing shows "ASK FOR PRICE". */
  price?: string | null;
  isNew?: boolean;
  stock?: StockState;
  /** Optional small line above the name, e.g. the category. */
  eyebrow?: string;
  /** Above the fold: load the photo eagerly. */
  eager?: boolean;
  sizes?: string;
  className?: string;
};

/** Portrait 4:5 card. The whole card is one link. */
export function ProductCard({
  name,
  href,
  image,
  hoverImage,
  price,
  isNew = false,
  stock = "in-stock",
  eyebrow,
  eager = false,
  sizes = "(min-width: 1024px) 280px, 50vw",
  className,
}: ProductCardProps) {
  const soldOut = stock === "sold-out";
  return (
    <Link href={href} className={cn("sf-card sf-focus group relative block rounded-[2px]", className)}>
      <ImageFrame ratio="4 / 5" className="rounded-[2px]">
        <div className="sf-card-media absolute inset-0">
          <StorefrontImg image={image} eager={eager} sizes={sizes} className={cn(soldOut && "grayscale-[35%]")} />
          {hoverImage ? <StorefrontImg image={hoverImage} sizes={sizes} decorative className="sf-card-alt" /> : null}
        </div>
        {isNew || stock !== "in-stock" ? (
          <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
            {isNew && !soldOut ? <Badge tone="lime">New</Badge> : null}
            {stock === "few-left" ? <Badge tone="light">Few left</Badge> : null}
            {soldOut ? <Badge tone="ink">Sold out</Badge> : null}
          </div>
        ) : null}
      </ImageFrame>
      <div className="flex flex-col gap-1.5 pt-3.5 sm:pt-4">
        {eyebrow ? <span className="sf-label text-[0.6875rem] text-brand-ink-soft">{eyebrow}</span> : null}
        <h3 className="line-clamp-2 font-serif text-xl font-medium leading-[1.15] text-brand-ink sm:text-[1.375rem]">
          {name}
        </h3>
        {price ? (
          <p className="sf-price text-brand-ink">
            <span className="sr-only">Price: </span>
            {price}
          </p>
        ) : (
          <p className="sf-label pt-1 text-brand-olive-700">Ask for price</p>
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
