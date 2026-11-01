import { Container } from "../Section";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import type { StorefrontImageData } from "../types";

type ListingHeaderProps = {
  /** Small tracked label above the title (e.g. "Collection"). */
  eyebrow?: string;
  title: string;
  description?: string | null;
  /** Category hero, or a lookbook photo on /shop and /new. Hidden when missing. */
  image?: StorefrontImageData | null;
};

/**
 * Listing page header (ZP-489): lime rule, serif title, optional description,
 * and the hero photo beside it on desktop (a short band under it on phones).
 * The photo is the LCP image, so it loads eagerly; it is cropped toward the
 * top so the portrait lookbook photos keep the face and outfit.
 */
export function ListingHeader({ eyebrow, title, description, image }: ListingHeaderProps) {
  return (
    <Container className="pt-8 sm:pt-12 lg:pt-16">
      <div className={image ? "grid items-center gap-8 md:grid-cols-2 lg:gap-14" : "max-w-[44rem]"}>
        <div className="flex flex-col gap-4 sm:gap-5">
          <span className="sf-rule" aria-hidden="true" />
          {eyebrow ? <p className="sf-label text-brand-olive-700">{eyebrow}</p> : null}
          <h1 className="sf-display text-balance text-brand-ink">{title}</h1>
          {description ? <p className="sf-body text-lg text-brand-ink-soft">{description}</p> : null}
        </div>
        {image ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-[2px] bg-brand-cream-100 md:aspect-[5/4]">
            <ImageFallback />
            <StorefrontImg
              image={image}
              eager
              sizes="(min-width: 1200px) 560px, (min-width: 768px) 50vw, 100vw"
              className="object-[50%_12%]"
            />
          </div>
        ) : null}
      </div>
    </Container>
  );
}
