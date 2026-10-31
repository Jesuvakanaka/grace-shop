import Link from "next/link";
import { cn } from "./cn";
import { ArrowRightIcon } from "./icons";
import { ImageFrame, StorefrontImg } from "./StorefrontImage";
import type { StorefrontImageData } from "./types";

type CategoryTileProps = {
  name: string;
  href: string;
  image: StorefrontImageData;
  /** Optional count line, e.g. "24 pieces". */
  meta?: string;
  ratio?: string;
  sizes?: string;
  className?: string;
};

/** Image with the category name on a cream plate (ink text, 13.38:1 on any photo). */
export function CategoryTile({
  name,
  href,
  image,
  meta,
  ratio = "4 / 5",
  sizes = "(min-width: 1024px) 380px, 50vw",
  className,
}: CategoryTileProps) {
  return (
    <Link href={href} className={cn("sf-card sf-focus group relative block rounded-[2px]", className)}>
      <ImageFrame ratio={ratio} className="rounded-[2px]">
        <div className="sf-card-media absolute inset-0">
          <StorefrontImg image={image} sizes={sizes} decorative />
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between gap-2 bg-brand-cream px-3.5 py-3 sm:inset-x-4 sm:bottom-4 sm:px-5 sm:py-4">
          <span className="flex flex-col gap-1">
            <span className="sf-label text-brand-ink sm:text-[0.8125rem]">{name}</span>
            {meta ? <span className="hidden text-xs text-brand-ink-soft sm:block">{meta}</span> : null}
          </span>
          <ArrowRightIcon className="sf-motion hidden h-4 w-4 shrink-0 sm:block text-brand-ink transition-transform duration-200 group-hover:translate-x-1" />
        </div>
      </ImageFrame>
    </Link>
  );
}
