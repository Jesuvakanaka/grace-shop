import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import { Container } from "./Section";
import { ImageFallback, StorefrontImg } from "./StorefrontImage";
import type { StorefrontImageData } from "./types";

type HeroAction = { label: string; href: string };

type HeroProps = {
  title: string;
  /** Sub-line under the headline, e.g. "Premium fashion. Modern you." */
  subline?: ReactNode;
  /** Small label above the headline. */
  eyebrow?: string;
  primary?: HeroAction;
  secondary?: HeroAction;
  /** 16:9 photo for desktop (and for mobile if `mobileImage` is missing). */
  image: StorefrontImageData;
  /** 4:5 photo for phones. */
  mobileImage?: StorefrontImageData;
  /**
   * "overlay": text over the photo on an ink gradient (white text, AA on any photo).
   * "split": text on cream beside the photo.
   */
  layout?: "overlay" | "split";
  /** Put the photo on the left in the split layout. */
  reverse?: boolean;
  /** The home hero is the page h1; editorial blocks further down use h2. */
  as?: "h1" | "h2";
  /** The hero photo is usually the LCP element: load it eagerly. */
  eager?: boolean;
  className?: string;
};

/** Art-directed hero photo (16:9 from md, 4:5 below) with the cream-tile fallback behaviour of StorefrontImg. */
function HeroPicture({
  image,
  mobileImage,
  eager,
}: {
  image: StorefrontImageData;
  mobileImage?: StorefrontImageData;
  eager: boolean;
}) {
  return (
    <StorefrontImg
      image={mobileImage ?? image}
      sources={mobileImage ? [{ media: "(min-width: 768px)", image }] : undefined}
      eager={eager}
      sizes="100vw"
    />
  );
}

function HeroActions({ primary, secondary, onDark }: { primary?: HeroAction; secondary?: HeroAction; onDark: boolean }) {
  if (!primary && !secondary) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {primary ? (
        <Button href={primary.href} variant="primary" arrow>
          {primary.label}
        </Button>
      ) : null}
      {secondary ? (
        <Button
          href={secondary.href}
          variant="ghost"
          // Over the photo (md+ overlay) the ghost turns white.
          className={onDark ? "md:border-white! md:text-white md:hover:bg-white md:hover:text-brand-ink" : undefined}
        >
          {secondary.label}
        </Button>
      ) : null}
    </div>
  );
}

export function Hero({
  title,
  subline,
  eyebrow,
  primary,
  secondary,
  image,
  mobileImage,
  layout = "overlay",
  reverse = false,
  as: Heading = "h1",
  eager = true,
  className,
}: HeroProps) {
  if (layout === "split") {
    return (
      <section className={cn("border-t border-brand-ink/10! bg-brand-cream py-14 sm:py-16 lg:py-24", className)}>
        <Container className="grid items-center gap-10 md:grid-cols-2 lg:gap-20">
          <div className={cn("relative aspect-[4/5] overflow-hidden rounded-[2px]", reverse ? "md:order-1" : "md:order-2")}>
            <ImageFallback />
            <HeroPicture image={mobileImage ?? image} eager={eager} />
          </div>
          <div className={cn("sf-fade-in flex flex-col gap-6", reverse ? "md:order-2" : "md:order-1")}>
            {eyebrow ? <p className="sf-label text-brand-olive-700">{eyebrow}</p> : null}
            <Heading className="sf-display text-balance text-brand-ink">{title}</Heading>
            {subline ? <p className="sf-body text-lg text-brand-ink-soft">{subline}</p> : null}
            <HeroActions primary={primary} secondary={secondary} onDark={false} />
          </div>
        </Container>
      </section>
    );
  }

  // Overlay: on phones the 4:5 photo stands alone and the text sits below it on
  // cream (the photo carries the page); from md the text overlays the 16:9 photo.
  return (
    <section className={cn("relative isolate bg-brand-cream md:overflow-hidden md:bg-brand-ink", className)}>
      <div className="relative aspect-[4/5] w-full md:aspect-[16/9] md:max-h-[820px]">
        <ImageFallback />
        <HeroPicture image={image} mobileImage={mobileImage} eager={eager} />
        {/* Soft deep-olive gradient: >= 75% under all hero text (text ends at ~40% of the width), so white text is AA on any photo. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden md:block md:bg-[linear-gradient(to_right,rgba(42,54,16,0.85)_0%,rgba(42,54,16,0.76)_45%,rgba(42,54,16,0)_75%)]"
        />
      </div>
      <div className="md:absolute md:inset-0 md:flex md:items-center">
        <Container className="py-10 sm:py-12 md:py-0">
          <div className="sf-fade-in flex max-w-[34rem] flex-col gap-5 text-brand-ink md:gap-6 md:text-white">
            {eyebrow ? <p className="sf-label text-brand-olive-700 md:text-brand-lime-200">{eyebrow}</p> : null}
            <Heading className="sf-display text-balance">{title}</Heading>
            {subline ? <p className="sf-body text-lg text-brand-ink-soft md:text-white">{subline}</p> : null}
            <HeroActions primary={primary} secondary={secondary} onDark />
          </div>
        </Container>
      </div>
    </section>
  );
}
