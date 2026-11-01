import { Button } from "../Button";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import type { HomeModel } from "./home-model";

type HomeHeroProps = {
  hero: HomeModel["hero"];
  shopHref: string;
  newArrivalsHref: string;
};

/**
 * The home hero (ZP-488), after docs/brand/references/vyra-home-mockup.webp.
 *
 * Phones: the portrait photo at 4:5, the text below it on cream (ink text,
 * italic accent in olive-700; never lime on cream).
 * md and up: left-weighted. Deep olive ground with the text on the left; the
 * photo fills the right half at full height (about 4:5 at 1280, so a 2:3
 * portrait keeps head to hem) and a soft olive-to-transparent gradient blends
 * its left edge into the ground. White text on olive-900 is 12.6:1; the lime
 * accent word on olive-900 is 5.3:1.
 *
 * The photo is the page's only eager image (fetchpriority high).
 */
export function HomeHero({ hero, shopHref, newArrivalsHref }: HomeHeroProps) {
  const { headline, subline, image } = hero;
  return (
    <section
      aria-labelledby="home-hero-title"
      className="relative isolate bg-brand-cream md:flex md:min-h-[600px] md:items-center md:overflow-hidden md:bg-brand-olive-900 lg:min-h-[min(760px,calc(100svh-5rem))]"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden md:absolute md:inset-y-0 md:right-0 md:aspect-auto md:w-1/2 lg:w-[52%]">
        <ImageFallback />
        <StorefrontImg
          image={image.image}
          sources={image.desktop ? [{ media: "(min-width: 768px)", image: image.desktop }] : undefined}
          eager
          sizes="(min-width: 1024px) 52vw, (min-width: 768px) 50vw, 100vw"
          className="object-[50%_12%]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden md:block md:bg-[linear-gradient(to_right,var(--color-brand-olive-900)_0%,rgba(42,54,16,0.55)_18%,rgba(42,54,16,0)_42%)]"
        />
      </div>

      <div className="relative mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6 sm:py-12 md:py-20 lg:px-8">
        <div className="sf-fade-in flex flex-col gap-6 md:max-w-[46%] md:gap-7 lg:max-w-[44%]">
          <h1
            id="home-hero-title"
            className="sf-display text-balance text-brand-ink md:text-[clamp(3.75rem,1rem+5.5vw,6.25rem)] md:leading-[1.02] md:text-white"
          >
            {headline.lead}
            {headline.accent ? (
              <>
                {" "}
                <em className="font-medium italic text-brand-olive-700 md:text-brand-lime">{headline.accent}</em>
              </>
            ) : null}
          </h1>
          <p className="font-sans text-sm font-medium uppercase leading-relaxed tracking-[0.22em] text-brand-ink-soft md:text-base md:tracking-[0.3em] md:text-brand-cream">
            {subline}
          </p>
          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
            <Button href={shopHref} variant="primary" arrow>
              Shop the collection
            </Button>
            <Button
              href={newArrivalsHref}
              variant="ghost"
              className="md:border-white! md:text-white md:hover:bg-white md:hover:text-brand-ink"
            >
              New arrivals
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
