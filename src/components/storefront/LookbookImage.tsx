import { cn } from "./cn";
import { LOOKBOOK, lookbookSrcSet, type LookbookStem } from "./lookbook";

type LookbookImageProps = {
  stem: LookbookStem;
  /** Override the manifest alt text; "" for a decorative photo. */
  alt?: string;
  /** `sizes` for the srcset. Default: full width on phones, half from md. */
  sizes?: string;
  /** Above the fold (the LCP photo): eager, high fetch priority. */
  eager?: boolean;
  className?: string;
};

/**
 * One of the owner's lookbook photos as a plain <img srcset> (640w + large),
 * with explicit width/height so it never shifts the layout. Server or client.
 * Inside a fixed-ratio frame use `lookbookImage(stem)` with StorefrontImg
 * instead, which adds the cream-tile fallback.
 */
export function LookbookImage({
  stem,
  alt,
  sizes = "(min-width: 768px) 50vw, 100vw",
  eager = false,
  className,
}: LookbookImageProps) {
  const photo = LOOKBOOK[stem];
  return (
    // Static files in public/: no optimiser needed, the srcset is pre-sized.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.large.src}
      srcSet={lookbookSrcSet(stem)}
      sizes={sizes}
      width={photo.large.width}
      height={photo.large.height}
      alt={alt ?? photo.alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      className={cn("h-auto w-full bg-brand-cream-100 object-cover", className)}
    />
  );
}
