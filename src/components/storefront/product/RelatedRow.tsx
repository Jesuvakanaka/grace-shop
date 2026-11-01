// ZP-503: "You may also like" on phones: a horizontal scroll row of small
// (140px) cards, each linking to its piece. Desktop keeps the 4-column grid
// in ProductView.
import Link from "next/link";
import { formatPriceUsd, toImageData, ASK_FOR_PRICE } from "../product";
import { ImageFrame, StorefrontImg } from "../StorefrontImage";
import type { PublicProduct } from "../types";

export function RelatedRow({ products, hrefFor, className }: { products: PublicProduct[]; hrefFor: (slug: string) => string; className?: string }) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="related-row-title" className={className}>
      <h2 id="related-row-title" className="font-serif text-[26px] font-medium leading-tight">
        You may also like
      </h2>
      <ul className="sf-scroll-x -mx-4 mt-3.5 flex gap-3 px-4 sm:-mx-6 sm:px-6">
        {products.map((p) => {
          const image = p.images[0];
          const price = formatPriceUsd(p.priceUsd) ?? ASK_FOR_PRICE;
          return (
            <li key={p.slug} className="w-[140px] shrink-0">
              <Link href={hrefFor(p.slug)} className="sf-focus flex flex-col gap-1.5 rounded-[2px] text-brand-ink">
                <ImageFrame ratio="140 / 186" className="rounded-[2px]">
                  {image ? <StorefrontImg image={toImageData(image)} decorative sizes="140px" /> : null}
                </ImageFrame>
                <span className="text-[13px] leading-snug">{p.name}</span>
                <span className="text-[13px] font-medium">{price}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
