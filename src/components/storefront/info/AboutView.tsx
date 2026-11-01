import { Button } from "../Button";
import { Container } from "../Section";
import { ImageFrame, StorefrontImg } from "../StorefrontImage";
import type { AboutModel } from "./info-model";

// ZP-491: the About page. A split tile like the brand board's "Be Bold. Be
// You.": serif headline and story on cream, the lifestyle photo beside it.
// The story hides when missing; headline, statement and photo always show.
export function AboutView({ model }: { model: AboutModel }) {
  return (
    <>
      <section aria-labelledby="about-title" className="bg-brand-cream text-brand-ink">
        <Container className="py-12 sm:py-16 lg:py-24">
          <div className="grid items-center gap-10 md:grid-cols-2 lg:gap-20">
            <div className="flex flex-col gap-6 md:order-1">
              <span className="sf-rule" aria-hidden="true" />
              <p className="sf-label text-brand-olive-700">About VYRA</p>
              <h1 id="about-title" className="sf-display text-balance">
                {model.headline}
              </h1>
              {model.story ? (
                <div className="flex flex-col gap-4">
                  {model.story.map((p, i) => (
                    <p key={i} className="sf-body whitespace-pre-line text-brand-ink-soft">
                      {p}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
            <ImageFrame ratio="4 / 5" className="md:order-2">
              <StorefrontImg image={model.image.image} eager sizes="(min-width: 768px) 50vw, 100vw" />
            </ImageFrame>
          </div>
        </Container>
      </section>

      <section aria-labelledby="about-meaning" className="border-t border-brand-ink/10! bg-brand-cream-100 text-brand-ink">
        <Container className="py-14 sm:py-16 lg:py-24">
          <div className="mx-auto flex max-w-[44rem] flex-col items-center gap-6 text-center">
            <span className="sf-rule" aria-hidden="true" />
            <h2 id="about-meaning" className="sf-title text-balance">
              {model.meaning.title}
            </h2>
            <p className="sf-body text-lg text-brand-ink-soft">{model.meaning.text}</p>
            <Button href={model.shopHref} variant="primary" arrow className="mt-2">
              Shop the collection
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
